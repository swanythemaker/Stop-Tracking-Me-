import hashlib
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
from safetensors.torch import load_file

OPSET = 17


class EncoderOnnx(torch.nn.Module):
    def __init__(self, encoder):
        super().__init__()
        self.encoder = encoder

    def forward(self, image):
        return self.encoder(image)


class DecoderOnnx(torch.nn.Module):
    def __init__(self, decoder):
        super().__init__()
        self.decoder = decoder

    def forward(self, latent):
        return self.decoder(latent).clamp(0, 1)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_image(h, w):
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    u, v = x / w, y / h
    r = 0.5 + 0.4 * np.sin(6 * u + 2 * v)
    g = 0.5 + 0.35 * np.cos(5 * v - 3 * u * u)
    b = 0.25 + 0.6 * u * v + 0.1 * np.sin(40 * u) * np.sin(40 * v)
    rng = np.random.default_rng(7)
    img = np.stack([r, g, b])[None] + rng.normal(0, 0.03, (1, 3, h, w)).astype(np.float32)
    return np.clip(img, 0, 1).astype(np.float32)


def axes(name):
    if name == "latent":
        return {2: "latent_height", 3: "latent_width"}
    return {2: "height", 3: "width"}


def export(module, example, path, in_name, out_name):
    torch.onnx.export(
        module,
        (example,),
        str(path),
        input_names=[in_name],
        output_names=[out_name],
        dynamic_axes={in_name: axes(in_name), out_name: axes(out_name)},
        opset_version=OPSET,
        do_constant_folding=True,
        dynamo=False,
    )
    model = onnx.load(str(path))
    onnx.checker.check_model(model)


def main():
    if len(sys.argv) != 3:
        print(f"usage: python {sys.argv[0]} <dir with taesd.py and safetensors> <output dir>")
        sys.exit(2)
    src = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(src))
    from taesd import Decoder, Encoder

    torch.manual_seed(0)
    encoder = Encoder(4)
    decoder = Decoder(4)
    encoder.load_state_dict(load_file(str(src / "taesd_encoder.safetensors")))
    decoder.load_state_dict(load_file(str(src / "taesd_decoder.safetensors")))
    enc = EncoderOnnx(encoder).eval()
    dec = DecoderOnnx(decoder).eval()

    enc_path = out / "taesd_encoder.onnx"
    dec_path = out / "taesd_decoder.onnx"
    with torch.no_grad():
        export(enc, torch.from_numpy(test_image(256, 256)), enc_path, "image", "latent")
        export(dec, torch.zeros(1, 4, 32, 32), dec_path, "latent", "image")

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    enc_sess = ort.InferenceSession(str(enc_path), opts, providers=["CPUExecutionProvider"])
    dec_sess = ort.InferenceSession(str(dec_path), opts, providers=["CPUExecutionProvider"])

    worst = 0.0
    for h, w in ((512, 512), (320, 448)):
        image = test_image(h, w)
        with torch.no_grad():
            lat_t = enc(torch.from_numpy(image)).numpy()
            img_t = dec(torch.from_numpy(lat_t)).numpy()
        lat_o = enc_sess.run(["latent"], {"image": image})[0]
        img_o = dec_sess.run(["image"], {"latent": lat_t})[0]
        d_lat = float(np.abs(lat_t - lat_o).max())
        d_img = float(np.abs(img_t - img_o).max())
        worst = max(worst, d_lat, d_img)
        err = float(np.mean((img_t - image) ** 2))
        psnr = 10 * np.log10(1.0 / err)
        print(f"{h}x{w} latent {tuple(lat_o.shape)} max abs diff {d_lat:.3e}; image {tuple(img_o.shape)} max abs diff {d_img:.3e}; torch round trip PSNR {psnr:.2f} dB")

    print(f"torch {torch.__version__} onnx {onnx.__version__} onnxruntime {ort.__version__} opset {OPSET}")
    for p in (enc_path, dec_path):
        print(f"{p.name} {p.stat().st_size} bytes sha256 {sha256(p)}")
    if worst > 0.001:
        print(f"max abs diff {worst:.3e} above 0.001")
        sys.exit(1)
    print(f"verified, max abs diff {worst:.3e}")


if __name__ == "__main__":
    main()
