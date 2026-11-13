
import {
    Injectable,
    InternalServerErrorException,
} from '@nestjs/common';

interface NvidiaEmbeddingResponse {
    data: Array<{
        embedding: number[];
    }>;
}

@Injectable()
export class EmbeddingService {
    private readonly apiUrl =
        'https://integrate.api.nvidia.com/v1/embeddings';

    private readonly model =
        process.env.NVIDIA_EMBEDDING_MODEL ??
        'nvidia/nemotron-3.5-embed-1b';

    async generateEmbedding(
        text: string,
        inputType: 'query' | 'passage',
    ): Promise<number[]> {
        const apiKey = process.env.NVIDIA_API_KEY;

        if (!apiKey) {
            throw new InternalServerErrorException(
                'NVIDIA API key is not configured.',
            );
        }

        const response = await fetch(this.apiUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                input: [text],
                model: this.model,
                input_type: inputType,
                encoding_format: 'float',
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            const errorText = await response.text();

            console.error('[NVIDIA EMBEDDING ERROR]', {
                status: response.status,
                message: errorText.slice(0, 500),
            });

            throw new InternalServerErrorException(
                'Unable to generate search embedding.',
            );
        }

        const result =
            (await response.json()) as NvidiaEmbeddingResponse;

        const embedding = result.data?.[0]?.embedding;

        if (!embedding || embedding.length !== 2048) {
            throw new InternalServerErrorException(
                `Invalid embedding dimensions. Expected 2048, received ${embedding?.length ?? 0}.`,
            );
        }

        return embedding;
    }
}
