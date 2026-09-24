export type ModelId = "migan" | "lama" | "taesdEnc" | "taesdDec";

export type ModelSpec = {
  id: ModelId;
  path: string;
  sha256: string;
  bytes: number;
  label: string;
  license: string;
};

export type FileSpec = { sha256: string; bytes: number };

export const CACHE_NAME = "stm-models-1";
export const FLORENCE_CACHE_NAME = "stm-florence-1";

export const MODELS: Record<ModelId, ModelSpec> = {
  migan: {
    id: "migan",
    path: "migan_pipeline_v2-6f1f3530a1a2.onnx",
    sha256: "6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b",
    bytes: 28_079_181,
    label: "Fast remover",
    license: "MIT",
  },
  lama: {
    id: "lama",
    path: "lama_fp32-1faef5301d78.onnx",
    sha256: "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6",
    bytes: 208_044_816,
    label: "High quality remover",
    license: "Apache-2.0",
  },
  taesdEnc: {
    id: "taesdEnc",
    path: "taesd_encoder-e85480fea37b.onnx",
    sha256: "e85480fea37bc6f0707fe3b03a5c2183cdeb7fc3794e78d05e70d9e58e65570c",
    bytes: 4_907_608,
    label: "Reduce hidden marks (encoder)",
    license: "MIT",
  },
  taesdDec: {
    id: "taesdDec",
    path: "taesd_decoder-caeaaf7ce871.onnx",
    sha256: "caeaaf7ce8719141d99a49e759f035e9e5abc56c64adf27dc978029a6d08b87f",
    bytes: 4_909_785,
    label: "Reduce hidden marks (decoder)",
    license: "MIT",
  },
};

export const FLORENCE: { dir: string; files: Record<string, FileSpec>; bytes: number } = {
  dir: "florence-2-base",
  files: {
    "config.json": { sha256: "74efbe2299e13cfcc9e083861eae4a943d76f784ddd595d85e779d189cf0a574", bytes: 5447 },
    "generation_config.json": { sha256: "25dc666f44506e0a63f5de2d191e5809b251527b282ff4951fad9840556407b3", bytes: 297 },
    "onnx/decoder_model_merged_int8.onnx": { sha256: "7ffecf4dd98784308878fd52a7f95ed64f5ed025b4785f6f105450be8fe2be04", bytes: 98177854 },
    "onnx/embed_tokens_int8.onnx": { sha256: "8818c58a214e53bf7e22c48bb4674c2fa3112b9539c3ce4075a2eac797b1ef74", bytes: 39390496 },
    "onnx/encoder_model_int8.onnx": { sha256: "a0459867dc116e8e49f53073e368e45c21169d0b0dd7dc350abed06926e0d835", bytes: 43651493 },
    "onnx/vision_encoder_int8.onnx": { sha256: "ec0649c0307316190b6b91ffb4582c82bb3ed19202b66395990fe340c27c07e5", bytes: 93788211 },
    "preprocessor_config.json": { sha256: "c892857e34a7082284983a7717717d39c9bf7e574f1f41d80d4c918c97502efa", bytes: 2673 },
    "tokenizer.json": { sha256: "d69dcdb2323e124ac4f800cb9863ddccea0d7bb11e16125e8df3bd60f2f8aeac", bytes: 2297961 },
    "tokenizer_config.json": { sha256: "d8e64607233cb53b619fb46664f6cad08176c26e0e8735b2d30d888364f19600", bytes: 197658 },
  },
  bytes: 277512090,
};

export function modelsBase(): string {
  return __MODELS_BASE__.replace(/\/$/, "");
}

export function modelUrl(path: string): string {
  return `${modelsBase()}/${path.replace(/^\//, "")}`;
}
