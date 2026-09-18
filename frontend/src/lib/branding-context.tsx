'use client';

import { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from './api';

export interface Branding {
  businessName: string;
  logoVersion: string | null;
  faviconVersion: string | null;
}

const DEFAULT_BRANDING: Branding = {
  businessName: 'Upcoming',
  logoVersion: null,
  faviconVersion: null,
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export const brandingQueryKey = ['branding'] as const;

function assetUrl(kind: 'logo' | 'favicon', version: string | null): string | null {
  if (!version && kind === 'logo') return null;
  return `/api/v1/settings/branding/assets/${kind}${version ? `?v=${encodeURIComponent(version)}` : ''}`;
}

export function useBranding() {
  const branding = useContext(BrandingContext);
  return {
    ...branding,
    logoUrl: assetUrl('logo', branding.logoVersion),
    faviconUrl: assetUrl('favicon', branding.faviconVersion),
  };
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: brandingQueryKey,
    queryFn: () => apiGet<Branding>('/settings/branding'),
    staleTime: 60_000,
    retry: 1,
  });
  const branding = data ?? DEFAULT_BRANDING;

  useEffect(() => {
    document.title = branding.businessName;

    // Keep one canonical icon link. Next may recreate metadata links during
    // navigation, so remove competing icons whenever the head changes.
    const favicon = document.getElementById('business-favicon') as HTMLLinkElement | null
      ?? document.createElement('link');
    favicon.id = 'business-favicon';
    favicon.rel = 'icon';
    favicon.type = branding.faviconVersion ? 'image/png' : 'image/svg+xml';
    favicon.href = assetUrl('favicon', branding.faviconVersion)!;
    if (!favicon.isConnected) document.head.appendChild(favicon);

    const appleIcon = document.getElementById('business-apple-icon') as HTMLLinkElement | null
      ?? document.createElement('link');
    appleIcon.id = 'business-apple-icon';
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.href = assetUrl('favicon', branding.faviconVersion)!;
    if (!appleIcon.isConnected) document.head.appendChild(appleIcon);

    const removeCompetingIcons = () => {
      document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach(link => {
        if (link !== favicon && link !== appleIcon) link.remove();
      });
      document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]').forEach(link => {
        if (link !== appleIcon) link.remove();
      });
    };
    removeCompetingIcons();
    const observer = new MutationObserver(removeCompetingIcons);
    observer.observe(document.head, { childList: true });

    const appleTitle = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.content = branding.businessName;
    return () => observer.disconnect();
  }, [branding.businessName, branding.faviconVersion]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}
