import { assert, get_event_element } from "./dom";

const PHOTO_THUMBS_ID = "listing_photo_thumbs";

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

function upload_to_s3(aws_pp: presigned_post, file: File, on_progress: progress_callback) {
    return new Promise((resolve, reject) => {
        const form = new FormData();

        // Append all presigned POST fields from your backend/AWS
        for (const [key, value] of Object.entries(aws_pp.fields)) {
            form.append(key, value);
        }

        // Must usually be last
        //console.log(aws_pp.fields["Content-Type"]);
        //form.append("Content-Type", file.type);
        form.append("file", file);
        console.log(`Should be setting content type to ${file.type}`);

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

async function do_listing_attachments_upload(files: FileList) {
    const thumb_cont = document.getElementById(PHOTO_THUMBS_ID);
    if (!thumb_cont) return;
    for (const file of files) {
        console.log("Listing attachment upload", file);
        const res: Response = await fetch("/api/upload/postimageurl");
        if (res.ok) {
            const presign: presigned_post = await res.json();

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

            function prog_func(percent: number) {
                progress_fill.style.width = `${percent}%`;
            }
            try {
                const upload_res = await upload_to_s3(presign, file, prog_func);
                console.log("UPLOADED!");
            }
            catch(err: any) {
                console.log(err);
            }
            
        } else {
            console.log("Failed request", res);
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
