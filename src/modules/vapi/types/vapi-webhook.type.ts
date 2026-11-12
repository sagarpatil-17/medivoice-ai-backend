export interface VapiToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: unknown;
    };
}

export interface VapiServerMessage {
    type: string;
    call?: {
        id?: string;
    };
    toolCallList?: VapiToolCall[];
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
