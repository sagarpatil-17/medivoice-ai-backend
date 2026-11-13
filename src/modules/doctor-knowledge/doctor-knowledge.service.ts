
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { EmbeddingService } from './services/embedding.service.js';

const SPECIALTIES = [
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
            'ent specialist',
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
        ],
    },
];

@Injectable()
export class DoctorKnowledgeService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly embeddingService: EmbeddingService,
    ) { }

    async indexSpecialties() {
        for (const item of SPECIALTIES) {
            const content = [
                item.specialty,
                item.department,
                item.description,
                ...item.synonyms,
            ].join('. ');

            const embedding =
                await this.embeddingService.generateEmbedding(
                    content,
                    'passage',
                );

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
                    ...item,
                    embedding,
                },
            });
        }

        return {
            message: 'Doctor specialty knowledge indexed.',
            count: SPECIALTIES.length,
        };
    }
}
