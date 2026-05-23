
export type http_error = Error & { status: number };

export function get_user_message_for_status(status: number) {
  if (status === 404) {
    return "We couldn’t find what you were looking for.";
  }

  if (status >= 500) {
    return "Something went wrong on our side. Please try again.";
  }

  if (status === 401) {
    return "You have been logged out - please sign in and try again.";
  }

  if (status === 403) {
    return "You don’t have permission to do that.";
  }

  return "Something went wrong. Please try again.";
}

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

