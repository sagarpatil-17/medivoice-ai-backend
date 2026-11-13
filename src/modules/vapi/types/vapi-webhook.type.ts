
export interface VapiToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: unknown;
    };
}

export interface VapiCall {
    id?: string;
    startedAt?: string;
    endedAt?: string;
    type?: string;
}

export interface VapiServerMessage {
    type: string;

    call?: VapiCall;

    // Tool calls
    toolCallList?: VapiToolCall[];

    // Status updates
    status?: string;

    // End-of-call report
    endedReason?: string;
    startedAt?: string;
    endedAt?: string;

    // Transcript
    transcript?: string;
    transcriptType?: string;
    role?: string;

    // End-of-call artifacts
    artifact?: {
        transcript?: string;
        recording?: unknown;
        messages?: unknown[];
    };

    // Optional summary
    summary?: string;
    analysis?: unknown;
}

export interface VapiWebhookBody {
    message: VapiServerMessage;
}

export interface VapiToolResult {
    name: string;
    toolCallId: string;
    result?: string;
    error?: string;
}

export interface VapiToolResponse {
    results: VapiToolResult[];
}
