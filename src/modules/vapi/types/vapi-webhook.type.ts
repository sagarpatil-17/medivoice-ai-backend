
export interface VapiToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: unknown;
    };
}

export interface VapiCustomer {
    number?: string;
    name?: string;
}

export interface VapiCall {
    id?: string;
    type?: string;
    status?: string;
    startedAt?: string;
    endedAt?: string;
    endedReason?: string;
    customer?: VapiCustomer;
    [key: string]: unknown;
}

export interface VapiRecording {
    url?: string;
    mono?: string;
    stereo?: string;
    [key: string]: unknown;
}

export interface VapiArtifact {
    transcript?: string;
    recording?: VapiRecording | string | null;
    recordingUrl?: string;
    stereoRecordingUrl?: string;
    messages?: unknown[];
}

export interface VapiAnalysis {
    summary?: string;
    structuredData?: Record<string, unknown>;
    successEvaluation?: string;
}

export interface VapiServerMessage {
    type: string;
    call?: VapiCall;

    phoneNumber?: string;
    status?: string;
    timestamp?: string;

    toolCallList?: VapiToolCall[];

    startedAt?: string;
    endedAt?: string;
    endedReason?: string;

    transcript?: string;
    transcriptType?: string;
    role?: string;

    summary?: string;
    analysis?: VapiAnalysis;
    artifact?: VapiArtifact;

    recordingUrl?: string;
    stereoRecordingUrl?: string;

    [key: string]: unknown;
}

export interface VapiWebhookBody {
    message: VapiServerMessage;
}

export interface VapiToolResult {
    name?: string;
    toolCallId: string;
    result?: string;
    error?: string;
}

export interface VapiToolResponse {
    results: VapiToolResult[];
}
