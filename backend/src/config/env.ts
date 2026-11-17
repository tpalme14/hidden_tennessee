function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined || value === "") return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`Environment variable ${name} must be "true" or "false"`);
}

/** A non-negative integer, defaulting to 0 when unset. Anything else is a startup error. */
function nonNegativeInteger(name: string): number {
  const value = process.env[name];
  if (value === undefined || value === "") return 0;
  if (!/^\d+$/.test(value)) {
    throw new Error(`Environment variable ${name} must be a non-negative integer`);
  }
  return Number(value);
}

const nodeEnv = process.env.NODE_ENV ?? "development";

/**
 * Mail transport selection (M03-T02 Increment 6). Production must choose
 * explicitly ("smtp" or "disabled"); elsewhere the default is "disabled",
 * under which password-reset requests answer 503 and create nothing.
 */
function mailTransportKind(): "smtp" | "disabled" {
  const value = process.env.MAIL_TRANSPORT;
  if (value === undefined || value === "") {
    if (nodeEnv === "production") {
      throw new Error('MAIL_TRANSPORT must be set to "smtp" or "disabled" in production');
    }
    return "disabled";
  }
  if (value === "smtp" || value === "disabled") return value;
  throw new Error('Environment variable MAIL_TRANSPORT must be "smtp" or "disabled"');
}

const mailTransport = mailTransportKind();

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  auth: {
    // Required in EVERY environment (developer decision, M03-T02 Increment 2):
    // Better Auth would otherwise fall back to a built-in default secret
    // outside production. Never log or expose this value.
    secret: required("BETTER_AUTH_SECRET"),
    // Public origin the auth endpoints are served from (ADR-008 single
    // origin), e.g. http://localhost:3000 locally.
    baseUrl: required("BETTER_AUTH_URL"),
    // The Vite dev server (frontend/vite.config.ts) proxies /api to the
    // backend, so browser requests carry its origin in development only.
    trustedOrigins: nodeEnv === "development" ? ["http://localhost:5173"] : [],
    // Rate limiting (M03-T02 Increment 5): on in production, off elsewhere
    // unless AUTH_RATE_LIMIT_ENABLED says otherwise (the tests enable it on
    // a dedicated instance instead).
    rateLimitEnabled: optionalBoolean("AUTH_RATE_LIMIT_ENABLED") ?? nodeEnv === "production",
    // Number of reverse-proxy hops between the client and this process whose
    // X-Forwarded-For entries are trusted (Express `trust proxy`). DEFAULT 0:
    // the socket peer is the client. A production value is set only after
    // the deployed proxy chain has been verified — see
    // src/auth/client-ip.ts. An over-count trusts client-supplied entries.
    trustedProxyHops: nonNegativeInteger("AUTH_TRUSTED_PROXY_HOPS"),
  },
  mail: {
    transport: mailTransport,
    // SMTP connection URL (carries credentials — never log it) and the
    // verified sender identity; both required only when transport is "smtp".
    smtpUrl: mailTransport === "smtp" ? required("SMTP_URL") : undefined,
    from: mailTransport === "smtp" ? required("MAIL_FROM") : undefined,
  },
};
