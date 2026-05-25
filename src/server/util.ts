import sharp, { type FitEnum, type FormatEnum, type ResizeOptions } from "sharp";
import { make_http_error } from "./web/error.js";
import os from "os";

const PNG_MAGIC_BUF: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function get_local_ip() {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]!) {
            // Skip over internal (i.e., 127.0.0.1) and non-IPv4 addresses
            if (net.family === "IPv4" && !net.internal) {
                return net.address;
            }
        }
    }
    return "localhost";
}

export function ext_from_content_type(content_type: string): string | null {
    switch (content_type.toLowerCase()) {
        // text
        case "text/plain": return "txt";
        case "text/html": return "html";
        case "text/css": return "css";
        case "text/csv": return "csv";
        case "text/javascript": return "js";
        case "text/markdown": return "md";
        case "text/xml": return "xml";

        // images
        case "image/jpeg": return "jpg";
        case "image/png": return "png";
        case "image/gif": return "gif";
        case "image/webp": return "webp";
        case "image/avif": return "avif";
        case "image/svg+xml": return "svg";
        case "image/bmp": return "bmp";
        case "image/tiff": return "tif";
        case "image/x-icon": return "ico";
        case "image/heic": return "heic";
        case "image/heif": return "heif";

        // audio
        case "audio/mpeg": return "mp3";
        case "audio/mp4": return "m4a";
        case "audio/wav": return "wav";
        case "audio/webm": return "webm";
        case "audio/ogg": return "ogg";
        case "audio/aac": return "aac";
        case "audio/flac": return "flac";
        case "audio/midi": return "mid";

        // video
        case "video/mp4": return "mp4";
        case "video/webm": return "webm";
        case "video/ogg": return "ogv";
        case "video/x-msvideo": return "avi";
        case "video/quicktime": return "mov";
        case "video/x-matroska": return "mkv";
        case "video/mpeg": return "mpeg";

        // application docs/data
        case "application/json": return "json";
        case "application/ld+json": return "jsonld";
        case "application/pdf": return "pdf";
        case "application/xml": return "xml";
        case "application/zip": return "zip";
        case "application/gzip": return "gz";
        case "application/x-7z-compressed": return "7z";
        case "application/x-rar-compressed": return "rar";
        case "application/x-tar": return "tar";

        // office docs
        case "application/msword": return "doc";
        case "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return "docx";
        case "application/vnd.ms-excel": return "xls";
        case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": return "xlsx";
        case "application/vnd.ms-powerpoint": return "ppt";
        case "application/vnd.openxmlformats-officedocument.presentationml.presentation": return "pptx";

        // web/app
        case "application/javascript": return "js";
        case "application/typescript": return "ts";
        case "application/wasm": return "wasm";
        case "application/xhtml+xml": return "xhtml";

        // forms / misc
        case "application/x-www-form-urlencoded": return "txt";
        case "multipart/form-data": return null;

        // fonts
        case "font/ttf": return "ttf";
        case "font/otf": return "otf";
        case "font/woff": return "woff";
        case "font/woff2": return "woff2";

        // older / vendor-ish common ones
        case "application/octet-stream": return "bin";
        case "application/postscript": return "ps";
        case "application/rtf": return "rtf";

        default:
            return null;
    }
}

export async function sanitize_image(
    file_buffer: Buffer,
    w: number,
    h: number,
    resize_opts: ResizeOptions,
    fmt: keyof FormatEnum = "webp",
    quality: number = 80
) {
    const sharp_img = sharp(file_buffer)
        .rotate()
        .resize(w, h, resize_opts)
        .toFormat(fmt, { quality: quality })
        .withMetadata({});
    try {
        const result = await sharp_img.toBuffer();
        return result;
    } catch (err: any) {
        throw make_http_error("Error processing image: " + err.message, 500);
    }
}

export function verify_buffer_is_image(buf: Buffer): boolean {
    const is_jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const is_png = buf.subarray(0, 8).equals(PNG_MAGIC_BUF);
    const is_riff = buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP";
    return is_jpeg || is_png || is_riff;
}
