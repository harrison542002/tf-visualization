/**
 * Derives the human-facing metadata a provider schema does not carry.
 *
 * Terraform schemas have no display name and no notion of category, so both are inferred from
 * the resource type. These are deliberately simple, overridable guesses — the curation layer
 * is where they get corrected, and the diff report is what surfaces the ones worth correcting.
 */

import type { ResourceCategory } from "@/lib/providers/types";

/** Words that are conventionally upper-cased in cloud resource names. */
const ACRONYMS = new Map<string, string>([
  ["vpc", "VPC"], ["vpn", "VPN"], ["dns", "DNS"], ["ip", "IP"], ["iam", "IAM"],
  ["ssl", "SSL"], ["tls", "TLS"], ["url", "URL"], ["api", "API"], ["sql", "SQL"],
  ["nat", "NAT"], ["cdn", "CDN"], ["ha", "HA"], ["ssh", "SSH"], ["kms", "KMS"],
  ["acl", "ACL"], ["id", "ID"], ["os", "OS"], ["db", "DB"], ["gke", "GKE"],
  ["ec2", "EC2"], ["s3", "S3"], ["rds", "RDS"], ["iot", "IoT"], ["ai", "AI"],
]);

/**
 * Category rules, checked in order. Networking is tested before compute because plenty of
 * network resources ("compute_firewall") sit under a compute product prefix.
 */
const CATEGORY_RULES: readonly (readonly [RegExp, ResourceCategory])[] = [
  [/(network|subnet|firewall|router|vpn|dns|route|gateway|load_balancer|lb|peering|endpoint|address|dhcp)/, "network"],
  [/(iam|service_account|role|policy|identity|principal|access_key|credential)/, "iam"],
  [/(storage|bucket|disk|volume|blob|filestore|file_system|snapshot|backup|image)/, "storage"],
  [/(instance|compute|vm|machine|function|container|cluster|node|run_|app_|batch|job|autoscal)/, "compute"],
];

/** `google_compute_subnetwork` -> `Subnetwork`. */
export function displayNameFor(resourceType: string, providerPrefix: string): string {
  const withoutProvider = resourceType.startsWith(providerPrefix)
    ? resourceType.slice(providerPrefix.length)
    : resourceType;

  const words = withoutProvider.split("_").filter(Boolean);
  // Drop a leading product segment when something follows it, so `compute_subnetwork` reads as
  // "Subnetwork" rather than "Compute Subnetwork".
  const meaningful = words.length > 1 ? words.slice(1) : words;

  return meaningful
    .map((word) => ACRONYMS.get(word) ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function categoryFor(resourceType: string): ResourceCategory {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(resourceType)) return category;
  }
  return "project";
}

/** `ip_cidr_range` -> `Ip Cidr Range`, with acronyms preserved. */
export function labelFor(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((word) => ACRONYMS.get(word) ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
