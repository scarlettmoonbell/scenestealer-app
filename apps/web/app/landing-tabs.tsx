"use client";

import { useState, type ReactNode } from "react";
import { Brand } from "./brand-name";

const steps = [
  {
    title: "Upload your recording",
    body: "Drop in the full-length video of your show — any length, no prep needed.",
    icon: (
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 16V4" />
        <path d="M7 9l5-5 5 5" />
        <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </svg>
    ),
  },
  {
    title: "We find the highlights",
    body: "Scene detection and audience-reaction analysis surface the moments worth sharing.",
    icon: (
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
        <path d="M6.5 6.5l2 2M15.5 15.5l2 2M17.5 6.5l-2 2M8.5 15.5l-2 2" />
      </svg>
    ),
  },
  {
    title: "Review, then publish",
    body: "Approve the clips you want, apply your caption templates, and either publish right away or schedule them for later — straight to your connected accounts.",
    icon: (
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M14 3h7v7" />
        <path d="M21 3l-9 9" />
        <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
      </svg>
    ),
  },
];

const platforms = [
  {
    name: "YouTube",
    note: "Connect your channel to publish the full-length upload or selected clips.",
  },
  {
    name: "Facebook",
    note: "Connect a Page to publish clips there.",
  },
  {
    name: "Instagram (Professional)",
    note: "Connect a Business or Creator account linked to your Facebook Page.",
  },
];

function HowItWorks() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 32,
      }}
    >
      {steps.map((step) => (
        <div
          key={step.title}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 10,
              background: "var(--surface-raised)",
              border: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent-text)",
            }}
          >
            {step.icon}
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 500 }}>{step.title}</h3>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
            {step.body}
          </p>
        </div>
      ))}
    </div>
  );
}

function WhySceneStealer() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 640,
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--muted)" }}>
        Promoting a show shouldn&rsquo;t take longer than rehearsing one.
        Scrubbing through hours of footage, cutting clips, writing captions, and
        posting to every platform by hand eats an evening after every
        performance.
      </p>
      <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--muted)" }}>
        <Brand /> does that work for you. Upload the full recording once, and
        get share-ready clips in minutes instead of hours at your laptop — so
        you spend less time promoting the show and more time putting it on.
      </p>
    </div>
  );
}

function WhatYouNeed() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        maxWidth: 640,
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      <p style={{ fontSize: 16, lineHeight: 1.6, color: "var(--muted)" }}>
        Connect the accounts you already use — no separate <Brand /> account for
        your audience to find.
      </p>
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {platforms.map((platform) => (
          <li
            key={platform.name}
            style={{
              display: "grid",
              gridTemplateColumns: "200px 1fr",
              gap: 12,
              alignItems: "baseline",
              textAlign: "left",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--heading)" }}>
              {platform.name}
            </span>
            <span style={{ fontSize: 15, color: "var(--muted)" }}>
              {platform.note}
            </span>
          </li>
        ))}
      </ul>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--muted)" }}>
        Switching Instagram to a Professional account is free and takes under a
        minute: open Instagram, go to Settings &rarr; Account type and tools
        &rarr; Switch to professional account, choose Creator, then link it to
        your Facebook Page when prompted.
      </p>
    </div>
  );
}

type TabKey = "how" | "why" | "what";

const tabs: { key: TabKey; label: ReactNode; content: ReactNode }[] = [
  { key: "how", label: "How it works", content: <HowItWorks /> },
  {
    key: "why",
    label: (
      <>
        Why Scene<span style={{ color: "#4f8ef7" }}>Stealer</span>
      </>
    ),
    content: <WhySceneStealer />,
  },
  { key: "what", label: "What you need", content: <WhatYouNeed /> },
];

export function LandingTabs() {
  const [active, setActive] = useState<TabKey>("how");
  const activeTab = tabs.find((tab) => tab.key === active) ?? tabs[0];

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        background: "var(--surface)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 1160, padding: "72px 24px" }}>
        <div
          role="tablist"
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 32,
            borderBottom: "1px solid var(--border)",
            marginBottom: 40,
          }}
        >
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active === tab.key}
              onClick={() => setActive(tab.key)}
              onMouseEnter={() => setActive(tab.key)}
              style={{
                background: "none",
                border: "none",
                borderBottom:
                  active === tab.key
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                padding: "0 0 16px",
                marginBottom: -1,
                fontFamily: "'Bodoni Moda', Georgia, serif",
                fontSize: 22,
                fontWeight: 500,
                color: active === tab.key ? "var(--heading)" : "var(--muted)",
                cursor: "pointer",
                transition: "color 150ms, border-color 150ms",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab.content}
      </div>
    </div>
  );
}
