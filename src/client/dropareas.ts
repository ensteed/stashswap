import { get_event_element } from "./dom";
import { type http_error, get_user_message_for_status, is_http_error } from "./error";
import { fetch_json } from "./util";

const PHOTO_THUMBS_ID = "listing_photo_thumbs";
const PHOTO_THUMBS_ERRORS_ID = "listing_photo_errors";

interface drop_area_meta {
    input_element_id: string;
    accepted_mime_types: Set<string>;
    accepted_exts: Set<string>;
    trigger: (files: FileList) => void;
}

const DROP_AREAS: Record<string, drop_area_meta> = {
    edit_listing_photo_drop_area: {
        input_element_id: "edit_listing_photo_upload_input",
        accepted_mime_types: new Set(["image/png", "image/jpeg", "image/webp"]),
        accepted_exts: new Set(["png", "webp", "jpeg", "jpg"]),
        trigger: do_listing_attachments_upload,
    },
};

type presigned_post = {
    url: string;
    fields: Record<string, string>;
};

type progress_callback = (percent: number) => void;

function upload_to_s3(aws_pp: presigned_post, file: File, on_progress: progress_callback): Promise<string> {
    return new Promise((resolve, reject) => {
        const form = new FormData();

        // Append all presigned POST fields from your backend/AWS
        for (const [key, value] of Object.entries(aws_pp.fields)) {
            form.append(key, value);
        }
        form.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", aws_pp.url, true);

        function on_upload_progress(event: ProgressEvent<EventTarget>) {
            if (event.lengthComputable) {
                const percent = (event.loaded / event.total) * 100;
                on_progress(percent);
            }
        }

        function on_upload_finished() {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.responseText);
            } else {
                reject(new Error(`Upload failed: ${xhr.status} ${xhr.responseText}`));
            }
        }

        xhr.upload.onprogress = on_upload_progress;
        xhr.onload = on_upload_finished;
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.onabort = () => reject(new Error("Upload aborted"));

        xhr.send(form);
    });
}

type temp_thumb_element = { container: HTMLElement; progress_fill: HTMLElement; presign: presigned_post; file: File };

function add_temp_photo_div(thumb_cont: HTMLElement, presign: presigned_post, file: File): temp_thumb_element {
    const div = document.createElement("div");
    div.className = "photo-thumb";

    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);

    const progress = document.createElement("div");
    progress.className = "progress";

    const progress_fill = document.createElement("div");
    progress_fill.className = "progress-fill";
    progress_fill.style.width = "10%";
    progress.appendChild(progress_fill);

    div.appendChild(img);
    div.appendChild(progress);
    thumb_cont.appendChild(div);
    return { container: div, progress_fill, presign, file };
}

function add_error_element(err: Error | http_error, error_cont: HTMLElement) {
    let msg: string;
    if (is_http_error(err)) {
        msg = get_user_message_for_status((err as http_error).status);
    } else if (err instanceof SyntaxError) {
        msg = "Server returned invalid data - please contact support.";
    } else if (err instanceof TypeError) {
        msg = "There was a network problem. Please try again.";
    } else if (err instanceof DOMException && err.name === "AbortError") {
        msg = "Upload request cancelled";
    } else if (err instanceof Error) {
        msg = "We couln't prepare your upload";
    } else {
        msg = "Unexpected error - please contact support.";
    }
    const err_element = document.createElement("p");
    err_element.textContent = msg;
    error_cont?.appendChild(err_element);
}

interface upload_result {
    msg: string;
    success: boolean;
}

type upload_payload = {
    key: string,
    content_type: string,
    orig_fname: string
};

async function upload_to_server(tmp_elem: temp_thumb_element): Promise<upload_result> {
    const s3_result = await upload_to_s3(
        tmp_elem.presign,
        tmp_elem.file,
        (percent: number) => (tmp_elem.progress_fill.style.width = `${percent}`)
    );
    ilog(`Got resonse ${s3_result}`);
    return { msg: s3_result, success: true };
}

async function do_listing_attachments_upload(files: FileList) {
    const thumb_cont = document.getElementById(PHOTO_THUMBS_ID);
    const error_cont = document.getElementById(PHOTO_THUMBS_ERRORS_ID);

    if (!thumb_cont || !error_cont) return;

    const promises: Promise<upload_result>[] = [];
    const tmp_elements: temp_thumb_element[] = [];
    for (const file of files) {
        ilog("Listing attachment upload", file);
        const params = new URLSearchParams({ type: file.type });
        const url = `/api/upload/postimageurl?type=${params.toString()}`;

        try {
            const presign: presigned_post = await fetch_json(url);
            const tmp_elem: temp_thumb_element = add_temp_photo_div(thumb_cont, presign, file);
            const prom = upload_to_server(tmp_elem);
            promises.push(prom);
        } catch (err: any) {
            ilog(`Got fetch error for ${file.name} to ${url}:`, err);
            add_error_element(err, error_cont);
        }
    }

    for (const tmp_element of tmp_elements) {
        try {
            const upload_res = await upload_to_s3(
                tmp_element.presign,
                tmp_element.file,
                (percent: number) => (tmp_element.progress_fill.style.width = `${percent}`)
            );
            console.log("UPLOADED!");
        } catch (err: any) {
            console.log(err);
        }
    }
}

function clear_drop_area_states() {
    for (const key of Object.keys(DROP_AREAS)) {
        const element = document.getElementById(key);
        if (element) element.classList.remove("valid", "invalid");
    }
}

function are_drop_items_valid(da: drop_area_meta, items: DataTransferItemList): boolean {
    for (let i = 0; i < items.length; ++i) {
        const kind = items[i].kind;
        const type = items[i].type;
        if (kind !== "file" || !da.accepted_mime_types.has(type)) return false;
    }
    return items.length > 0;
}

function are_drop_files_valid(da: drop_area_meta, files: FileList): boolean {
    if (!da) return false;
    for (let i = 0; i < files.length; ++i) {
        const file = files.item(i);
        if (!file) return false;
        const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "";
        const accepted_mime_type = da.accepted_mime_types.has(file.type);
        const accepted_file_ext = ext && da.accepted_exts.has(ext);
        if (!accepted_mime_type && !accepted_file_ext) return false;
    }
    return files.length > 0;
}

export function handle_drop_drop_areas(e: DragEvent) {
    const item = get_event_element(e.target);
    if (!item) return;
    const da = DROP_AREAS[item.id];
    if (!da || !e.dataTransfer?.files) return;
    const da_valid = are_drop_files_valid(da, e.dataTransfer.files);
    if (!da_valid) return;
    da.trigger(e.dataTransfer.files);
    clear_drop_area_states();
}

export function handle_click_drop_areas(event: MouseEvent) {
    const target = get_event_element(event.target);
    if (!target) return;
    const da = target ? DROP_AREAS[target.id] : null;
    const input_elem = da ? document.getElementById(da.input_element_id) : null;
    if (input_elem) input_elem.click();
}

export function handle_dragover_drop_areas(e: DragEvent) {
    clear_drop_area_states();
    const item = get_event_element(e.target);
    if (!item) return;
    let da: drop_area_meta | null = null;
    let da_element: HTMLElement | null = null;
    for (const [id, daval] of Object.entries(DROP_AREAS)) {
        da_element = document.getElementById(id);
        if (da_element?.contains(item)) {
            da = daval;
            break;
        }
    }

    if (!da || !e.dataTransfer?.files || !da_element) return;
    const da_valid = are_drop_items_valid(da, e.dataTransfer.items);
    da_element.classList.toggle("valid", da_valid);
    da_element.classList.toggle("invalid", !da_valid);
}

export function handle_change_drop_areas(e: Event) {
    const item = get_event_element(e.target) as HTMLInputElement;
    if (!item) return;
    for (const das of Object.values(DROP_AREAS)) {
        if (das.input_element_id === item.id && item.files) {
            das.trigger(item.files);
            return;
        }
    }
}
