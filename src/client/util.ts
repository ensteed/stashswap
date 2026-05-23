import { make_http_error } from "./error";
export function assert(condition: boolean, message: string = "") {
    if (!condition) {
        throw new Error("Assertion failed" + (message ? ": " + message : ""));
    }
}

export async function fetch_json(url: string): Promise<any> {

    const res: Response = await fetch(url);
    if (!res.ok) {
        make_http_error(`Fetch ${url} http ${res.status} error: ${res.statusText}`, res.status);
    }
    return await res.json();
}
