import template from "../template.js";

interface err_response {
    message: string;
}

type http_error = Error & { status: number };
export function make_http_error(arg: string | Error, status: number): http_error {
    const err = typeof arg === "string" ? new Error(arg) : arg;
    return Object.assign(err, { status });
}

export function is_http_error(err: unknown): boolean {
    return err instanceof Error && typeof (err as any).status === "number";
}

export function rethrow_http_error(err: unknown) {
    if (is_http_error(err)) throw err;
}

export function create_err_resp(err: Error | string) {
    const errc: err_response = {
        message: typeof err === "string" ? err : err.message,
    };
    ilog(errc);
    return template.render_fragment("errmsg.html", { msg: errc.message })
}
