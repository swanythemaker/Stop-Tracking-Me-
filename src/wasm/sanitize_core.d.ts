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

export class PlaneScratch {
    free(): void;
    [Symbol.dispose](): void;
    inputLen(): number;
    inputPtr(): number;
    constructor(max_bytes: number);
    outputPtr(): number;
    transform(fmt: string, width: number, height: number, opts_json: string): PlanesOut;
}

export class PlanesOut {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly height: number;
    readonly len: number;
    readonly ptr: number;
    readonly width: number;
}

export class PlanesResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    takeBytes(): Uint8Array;
    readonly height: number;
    readonly width: number;
}

export class ReadReq {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly len: number;
    readonly offset: number;
}

export class RebuildTail {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    takeHead(): Uint8Array;
    takeTail(): Uint8Array;
}

export class StripAuditResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    takeBytes(): Uint8Array;
    readonly auditJson: string;
    readonly passed: boolean;
}

export class VideoAudit {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    feed(offset: number, bytes: Uint8Array): void;
    finish(): string;
    nextRead(): ReadReq | undefined;
    static open(file_len: number, strict?: boolean | null): VideoAudit;
    setWindow(bytes: number): void;
}

export class VideoRebuild {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    error(): string | undefined;
    feed(offset: number, bytes: Uint8Array): void;
    finish(): RebuildTail;
    nextRead(): ReadReq | undefined;
    static open(file_len: number): VideoRebuild;
    phase(): string;
    planJson(): string;
    setOptions(json: string): void;
    takeOutput(): Uint8Array;
}

export function auditBytes(input: Uint8Array): string;

export function decodeAndTransform(input: Uint8Array, opts_json: string): DecodeResult;

export function stripAndAudit(encoded: Uint8Array, format: string): StripAuditResult;

export function transformPlanes(src: Uint8Array, fmt: string, width: number, height: number, opts_json: string): PlanesResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_decoderesult_free: (a: number, b: number) => void;
    readonly __wbg_planescratch_free: (a: number, b: number) => void;
    readonly __wbg_planesout_free: (a: number, b: number) => void;
    readonly __wbg_planesresult_free: (a: number, b: number) => void;
    readonly __wbg_readreq_free: (a: number, b: number) => void;
    readonly __wbg_stripauditresult_free: (a: number, b: number) => void;
    readonly __wbg_videoaudit_free: (a: number, b: number) => void;
    readonly __wbg_videorebuild_free: (a: number, b: number) => void;
    readonly auditBytes: (a: number, b: number, c: number) => void;
    readonly decodeAndTransform: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly decoderesult_takeRgba: (a: number, b: number) => void;
    readonly planescratch_inputLen: (a: number) => number;
    readonly planescratch_new: (a: number, b: number) => void;
    readonly planescratch_transform: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly planesresult_takeBytes: (a: number, b: number) => void;
    readonly rebuildtail_takeHead: (a: number, b: number) => void;
    readonly rebuildtail_takeTail: (a: number, b: number) => void;
    readonly stripAndAudit: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly stripauditresult_auditJson: (a: number, b: number) => void;
    readonly stripauditresult_passed: (a: number) => number;
    readonly stripauditresult_takeBytes: (a: number, b: number) => void;
    readonly transformPlanes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => void;
    readonly videoaudit_feed: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly videoaudit_finish: (a: number, b: number) => void;
    readonly videoaudit_nextRead: (a: number) => number;
    readonly videoaudit_open: (a: number, b: number, c: number) => void;
    readonly videoaudit_setWindow: (a: number, b: number) => void;
    readonly videorebuild_error: (a: number, b: number) => void;
    readonly videorebuild_feed: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly videorebuild_finish: (a: number, b: number) => void;
    readonly videorebuild_nextRead: (a: number) => number;
    readonly videorebuild_open: (a: number, b: number) => void;
    readonly videorebuild_phase: (a: number, b: number) => void;
    readonly videorebuild_planJson: (a: number, b: number) => void;
    readonly videorebuild_setOptions: (a: number, b: number, c: number, d: number) => void;
    readonly videorebuild_takeOutput: (a: number, b: number) => void;
    readonly planesout_ptr: (a: number) => number;
    readonly readreq_offset: (a: number) => number;
    readonly decoderesult_height: (a: number) => number;
    readonly decoderesult_origHeight: (a: number) => number;
    readonly decoderesult_origWidth: (a: number) => number;
    readonly decoderesult_width: (a: number) => number;
    readonly planesout_height: (a: number) => number;
    readonly planesout_len: (a: number) => number;
    readonly planesout_width: (a: number) => number;
    readonly planesresult_height: (a: number) => number;
    readonly planesresult_width: (a: number) => number;
    readonly readreq_len: (a: number) => number;
    readonly planescratch_inputPtr: (a: number) => number;
    readonly planescratch_outputPtr: (a: number) => number;
    readonly __wbg_rebuildtail_free: (a: number, b: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
