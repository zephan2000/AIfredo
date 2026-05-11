import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MCP Streamable HTTP server + OAuth 2.1 issuer.
 * Phase 0: only the OAuth metadata document is implemented. Full implementation
 * (DCR /register, /authorize, /token, MCP tool dispatch) lands in Phase 2.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ slug: string[] }> },
): Promise<NextResponse> {
  const { slug } = await context.params;
  const path = slug.join("/");
  const issuer = process.env.MCP_ISSUER_URL;
  if (!issuer) return NextResponse.json({ error: "MCP_ISSUER_URL unset" }, { status: 500 });

  if (path === ".well-known/oauth-authorization-server") {
    return NextResponse.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
      scopes_supported: ["mcp"],
    });
  }

  return NextResponse.json({ error: "not_implemented", phase: 2 }, { status: 501 });
}

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "not_implemented", phase: 2 }, { status: 501 });
}
