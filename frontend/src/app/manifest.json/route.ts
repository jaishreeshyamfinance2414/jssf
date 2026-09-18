import { NextRequest, NextResponse } from 'next/server';

// Existing installed copies may still request the former static manifest URL.
export function GET(request: NextRequest) {
  return NextResponse.redirect(new URL('/api/v1/settings/branding/manifest', request.url), 307);
}
