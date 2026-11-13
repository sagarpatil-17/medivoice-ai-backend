
import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
} from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';
import { EmbeddingService } from './services/embedding.service.js';

interface SpecialtyKnowledge {
    specialty: string;
    department: string;
    description: string;
    synonyms: string[];
}

interface SpecialtySearchResult {
    _id: {
        $oid: string;
    };
    specialty: string;
    department: string;
    description: string;
    score: number;
}

@Injectable()
export class DoctorKnowledgeService {
    private readonly VECTOR_INDEX_NAME =
        'doctor_knowledge_vector_index';

    private readonly VECTOR_DIMENSIONS = 2048;

    private readonly MIN_SIMILARITY_SCORE = 0.70;

    private readonly MAX_RESULTS = 3;

    private readonly specialties: SpecialtyKnowledge[] = [
        {
            specialty: 'Dermatology',
            department: 'Dermatology',
            description:
                'Specialty dealing with skin, hair and nail conditions.',
            synonyms: [
                'skin doctor',
                'dermatologist',
                'hair loss',
                'acne',
                'skin allergy',
                'skin specialist',
                'hair doctor',
                'skin problems',
            ],
        },
        {
            specialty: 'Cardiology',
            department: 'Cardiology',
            description:
                'Specialty dealing with the heart and cardiovascular system.',
            synonyms: [
                'heart doctor',
                'cardiologist',
                'heart specialist',
                'heart health',
                'cardiac specialist',
                'heart problems',
            ],
        },
        {
            specialty: 'Orthopedics',
            department: 'Orthopedics',
            description:
                'Specialty dealing with bones, joints, muscles and fractures.',
            synonyms: [
                'bone doctor',
                'orthopedic doctor',
                'joint pain',
                'fracture specialist',
                'knee specialist',
                'back pain specialist',
                'bone specialist',
            ],
        },
        {
            specialty: 'Pediatrics',
            department: 'Pediatrics',
            description:
                'Medical care for infants, children and adolescents.',
            synonyms: [
                'child doctor',
                'children specialist',
                'baby doctor',
                'pediatrician',
                'kids doctor',
                'child specialist',
            ],
        },
        {
            specialty: 'Gynecology',
            department: 'Gynecology',
            description:
                "Women's reproductive health and pregnancy-related care.",
            synonyms: [
                'women doctor',
                'gynecologist',
                'pregnancy doctor',
                'women health specialist',
                'female health specialist',
            ],
        },
        {
            specialty: 'ENT',
            department: 'ENT',
            description:
                'Specialty dealing with ear, nose and throat conditions.',
            synonyms: [
                'ear doctor',
                'nose doctor',
                'throat doctor',
                'ENT specialist',
                'ear nose throat specialist',
            ],
        },
        {
            specialty: 'Neurology',
            department: 'Neurology',
            description:
                'Specialty dealing with the brain, nerves and nervous system.',
            synonyms: [
                'brain doctor',
                'nerve specialist',
                'neurologist',
                'migraine specialist',
                'headache specialist',
                'nervous system specialist',
            ],
        },
    ];

    constructor(
        private readonly prisma: PrismaService,
        private readonly embeddingService: EmbeddingService,
    ) { }

    // ==========================================
    // 1. INDEX SPECIALTY KNOWLEDGE
    // ==========================================

    async indexSpecialties() {
        let indexedCount = 0;

        for (const item of this.specialties) {
            const content = [
                `Specialty: ${item.specialty}`,
                `Department: ${item.department}`,
                `Description: ${item.description}`,
                `Related terms: ${item.synonyms.join(', ')}`,
            ].join('. ');

            const embedding =
                await this.embeddingService.generateEmbedding(
                    content,
                    'passage',
                );

            if (embedding.length !== this.VECTOR_DIMENSIONS) {
                throw new InternalServerErrorException(
                    `Invalid embedding dimensions for ${item.specialty}.`,
                );
            }

            await this.prisma.doctorKnowledge.upsert({
                where: {
                    specialty: item.specialty,
                },
                update: {
                    department: item.department,
                    description: item.description,
                    synonyms: item.synonyms,
                    embedding,
                    isActive: true,
                },
                create: {
                    specialty: item.specialty,
                    department: item.department,
                    description: item.description,
                    synonyms: item.synonyms,
                    embedding,
                    isActive: true,
                },
            });

            indexedCount++;
        }

        return {
            message: 'Doctor specialty knowledge indexed.',
            count: indexedCount,
        };
    }

    // ==========================================
    // 2. SEMANTIC SPECIALTY SEARCH
    // ==========================================

    async searchSpecialty(
        query: string,
    ): Promise<SpecialtySearchResult[]> {
        const normalizedQuery = query?.trim();

        if (
            !normalizedQuery ||
            normalizedQuery.length < 2 ||
            normalizedQuery.length > 300
        ) {
            throw new BadRequestException(
                'Please provide a valid specialty search query.',
            );
        }

        // Generate query embedding using NVIDIA Nemotron.
        const queryEmbedding =
            await this.embeddingService.generateEmbedding(
                normalizedQuery,
                'query',
            );

        if (queryEmbedding.length !== this.VECTOR_DIMENSIONS) {
            throw new InternalServerErrorException(
                'Invalid query embedding dimensions.',
            );
        }

        // Search MongoDB Atlas Vector Search.
        const response =
            await this.prisma.doctorKnowledge.aggregateRaw({
                pipeline: [
                    {
                        $vectorSearch: {
                            index: this.VECTOR_INDEX_NAME,
                            path: 'embedding',
                            queryVector: queryEmbedding,
                            numCandidates: 50,
                            limit: this.MAX_RESULTS,
                            filter: {
                                isActive: true,
                            },
                        },
                    },
                    {
                        $project: {
                            _id: 1,
                            specialty: 1,
                            department: 1,
                            description: 1,
                            score: {
                                $meta: 'vectorSearchScore',
                            },
                        },
                    },
                ],
            });

        return response as unknown as SpecialtySearchResult[];
    }

    // ==========================================
    // 3. FIND DOCTORS USING NATURAL LANGUAGE
    // ==========================================

    async findDoctorsByQuery(query: string) {
        const matches = await this.searchSpecialty(query);

        const bestMatch = matches[0];

        // No reliable specialty match.
        if (
            !bestMatch ||
            bestMatch.score < this.MIN_SIMILARITY_SCORE
        ) {
            return {
                matched: false,
                message:
                    'Could not confidently identify the required specialty. Please clarify which type of doctor you need.',
                suggestions: matches.map((match) => ({
                    specialty: match.specialty,
                    department: match.department,
                    confidence: Number(match.score.toFixed(3)),
                })),
                doctors: [],
            };
        }

        // Fetch actual doctors from the database.
        // Vector Search identifies specialty only.
        const doctors = await this.prisma.doctor.findMany({
            where: {
                specialization: {
                    equals: bestMatch.specialty,
                },
                isActive: true,
                user: {
                    is: {
                        isActive: true,
                    },
                },
                department: {
                    is: {
                        isActive: true,
                    },
                },
            },
            select: {
                id: true,
                fullName: true,
                specialization: true,
                qualification: true,
                experienceYears: true,
                consultationFee: true,
                department: {
                    select: {
                        name: true,
                    },
                },
            },
            orderBy: {
                fullName: 'asc',
            },
            take: 10,
        });

        if (doctors.length === 0) {
            return {
                matched: true,
                specialty: bestMatch.specialty,
                department: bestMatch.department,
                confidence: Number(bestMatch.score.toFixed(3)),
                message:
                    'The specialty was identified, but no active doctors are currently available in this department.',
                doctors: [],
            };
        }

        return {
            matched: true,
            specialty: bestMatch.specialty,
            department: bestMatch.department,
            confidence: Number(bestMatch.score.toFixed(3)),
            count: doctors.length,
            doctors: doctors.map((doctor) => ({
                id: doctor.id,
                name: doctor.fullName,
                specialization: doctor.specialization,
                qualification: doctor.qualification,
                experienceYears: doctor.experienceYears,
                consultationFee:
                    doctor.consultationFee / 100,
                currency: 'INR',
                department: doctor.department.name,
            })),
        };
    }

    // ==========================================
    // 4. CHECK INDEXED KNOWLEDGE DOCUMENTS
    // ==========================================

    async checkKnowledgeDocuments() {
        const documents =
            await this.prisma.doctorKnowledge.findMany({
                select: {
                    id: true,
                    specialty: true,
                    department: true,
                    isActive: true,
                    embedding: true,
                },
            });

        return {
            count: documents.length,
            documents: documents.map((doc) => ({
                id: doc.id,
                specialty: doc.specialty,
                department: doc.department,
                isActive: doc.isActive,
                embeddingDimensions: doc.embedding.length,
            })),
        };
    }
}
