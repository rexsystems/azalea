import { getSiteUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

type JsonLdProps = {
  data: Record<string, unknown> | Record<string, unknown>[];
};

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function softwareApplicationLd() {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "SSH Client",
    operatingSystem: "Windows, Linux, macOS",
    description: SITE_DESCRIPTION,
    url: siteUrl,
    downloadUrl: `${siteUrl}/download`,
    image: `${siteUrl}/og.jpg`,
    screenshot: `${siteUrl}/og.jpg`,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    author: {
      "@type": "Organization",
      name: "Rexsystems",
      url: "https://rexsystems.me",
    },
    softwareLicense: "https://www.gnu.org/licenses/agpl-3.0.html",
    featureList: [
      "Multi-tab SSH terminal",
      "SFTP file browser",
      "SSH key manager",
      "Port forwarding",
      "Local terminal",
      "Zero-knowledge encrypted sync",
    ],
  };
}

export function websiteLd() {
  const siteUrl = getSiteUrl();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: siteUrl,
    description: SITE_DESCRIPTION,
    publisher: {
      "@type": "Organization",
      name: "Rexsystems",
      url: "https://rexsystems.me",
    },
  };
}

export function faqLd(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
