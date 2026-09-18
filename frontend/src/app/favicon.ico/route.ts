import { NextRequest, NextResponse } from 'next/server';

// Browsers that request the conventional path get the current settings icon.
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL('/api/v1/settings/branding/assets/favicon', request.url), 307);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
