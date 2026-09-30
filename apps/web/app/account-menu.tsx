"use client";

import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { useClerkThemeVariables } from "./clerk-theme";

// A small inline icon rather than an image asset — UserButton.Link
// requires a labelIcon, and this is the only place in the app that
// needs one this size.
function AccountIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="5.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.5 14c.9-2.8 3-4.3 5.5-4.3s4.6 1.5 5.5 4.3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Themed replacements for Clerk's stock <OrganizationSwitcher/> and
// <UserButton/> — previously rendered fully unstyled (no `appearance`
// prop at all), the likely root cause of them looking "practically
// unusable," especially in dark mode (the same failure class
// themed-sign-in.tsx already fixed once for the sign-in card). Also
// adds a direct "Account" link to the avatar's dropdown so billing/
// profile is reachable without going through DashboardTabs.
export function AccountMenu() {
  const variables = useClerkThemeVariables();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      {/* afterCreateOrganizationUrl/afterSelectOrganizationUrl explicit
          for the same reason as page.tsx's CreateOrganization — see its
          comment. createOrganizationMode/organizationProfileMode already
          default to "modal" (in-app), so those two are the only ones
          this component's own create-org flow needs. */}
      <OrganizationSwitcher
        hidePersonal
        afterCreateOrganizationUrl="/"
        afterSelectOrganizationUrl="/"
        appearance={{ variables }}
      />
      <UserButton appearance={{ variables }}>
        <UserButton.MenuItems>
          <UserButton.Link
            label="Account"
            labelIcon={<AccountIcon />}
            href="/account"
          />
        </UserButton.MenuItems>
      </UserButton>
    </div>
  );
}
