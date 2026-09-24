export class DecodeResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    takeRgba(): Uint8Array;
    readonly height: number;
    readonly origHeight: number;
    readonly origWidth: number;
    readonly width: number;
}

export class StripAuditResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    takeBytes(): Uint8Array;
    readonly auditJson: string;
    readonly passed: boolean;
}

export function auditBytes(input: Uint8Array): string;

export function decodeAndTransform(input: Uint8Array, opts_json: string): DecodeResult;

export function stripAndAudit(encoded: Uint8Array, format: string): StripAuditResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_decoderesult_free: (a: number, b: number) => void;
    readonly __wbg_stripauditresult_free: (a: number, b: number) => void;
    readonly auditBytes: (a: number, b: number, c: number) => void;
    readonly decodeAndTransform: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decoderesult_takeRgba: (a: number, b: number) => void;
    readonly stripAndAudit: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly stripauditresult_auditJson: (a: number, b: number) => void;
    readonly stripauditresult_passed: (a: number) => number;
    readonly stripauditresult_takeBytes: (a: number, b: number) => void;
    readonly decoderesult_height: (a: number) => number;
    readonly decoderesult_origHeight: (a: number) => number;
    readonly decoderesult_origWidth: (a: number) => number;
    readonly decoderesult_width: (a: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
