/**
 * Infers connection slots from attribute names.
 *
 * Provider schemas say nothing about references — `aws_subnet.vpc_id` is just a string — so the
 * only signal available offline is naming convention, and the conventions are strong: AWS and
 * Azure suffix references with `_id`/`_arn`/`_name`, and GCP names them after the resource
 * (`network`, `subnetwork`).
 *
 * The safety rail is that a slot is only emitted when the candidate resource type **actually
 * exists in the same provider**. A wrong slot is worse than a missing one: it lets the user
 * draw an edge that compiles to invalid Terraform, whereas a missing one just leaves the
 * attribute as a text field. Everything here errs toward emitting nothing.
 *
 * An attribute promoted to a slot **stays** a field. Most reference attributes accept either
 * a literal or a reference — `image` can be `debian-cloud/debian-12` or a link to a
 * `google_compute_image` — so the user gets both a handle and a text box, and the compiler
 * prefers the connection when one exists. That also makes an over-eager inference cheap:
 * a spurious handle is ignorable, whereas a deleted field is not.
 */

import type { ConnectionSlot, FieldSchema, ResourceSchema } from "@/lib/providers/types";
import { labelFor as titleCase } from "./naming";

export interface AliasTarget {
  readonly type: string;
  readonly attribute: string;
}

interface SuffixRule {
  /** Attribute suffix, e.g. `_id`. Empty matches the whole attribute name. */
  readonly suffix: string;
  /** Attribute read off the target resource. */
  readonly targetAttribute: string;
  /** Forces many-cardinality regardless of the field type, for plural names. */
  readonly plural?: boolean;
  /**
   * Only resolve this rule through the alias table, never mechanically.
   *
   * Used for the bare-name rule: AWS really does have unsuffixed references such as
   * `aws_lambda_function.role`, but testing every bare string attribute against
   * `aws_<name>` would guess far too freely. Listing them is the precise option.
   */
  readonly aliasOnly?: boolean;
}

export interface InferenceRules {
  readonly prefix: string;
  /** Checked in order, so longer suffixes must come first. */
  readonly suffixes: readonly SuffixRule[];
  /** Attribute names that are never references, however they look. */
  readonly deny: ReadonlySet<string>;
  /**
   * Base name to target, for references that do not map mechanically.
   *
   * The object form also pins the attribute read off the target, which matters when the
   * default is wrong: Cloud Run wants a service account’s `email`, not its `id`.
   */
  readonly aliases: Readonly<Record<string, string | AliasTarget>>;
  /** Candidate resource types for a base name, most specific first. */
  readonly candidates: (base: string, ownerType: string) => readonly string[];
}

/** Everything after the provider prefix, e.g. `aws_subnet` -> `subnet`. */
const withoutPrefix = (type: string, prefix: string): string =>
  type.startsWith(prefix) ? type.slice(prefix.length) : type;

export const AWS_RULES: InferenceRules = {
  prefix: "aws_",
  suffixes: [
    { suffix: "_ids", targetAttribute: "id", plural: true },
    { suffix: "_arns", targetAttribute: "arn", plural: true },
    { suffix: "_names", targetAttribute: "name", plural: true },
    { suffix: "_id", targetAttribute: "id" },
    { suffix: "_arn", targetAttribute: "arn" },
    { suffix: "_name", targetAttribute: "name" },
    { suffix: "", targetAttribute: "arn", aliasOnly: true },
  ],
  deny: new Set([
    "id",
    "arn",
    "name",
    "owner_id",
    "account_id",
    "aws_account_id",
    "caller_identity",
    "region",
    "availability_zone",
    "availability_zone_id",
    "key_name",
    "kms_key_id",
    "display_name",
    "domain_name",
    "bucket_name",
    "user_name",
    "group_name",
    "tag_name",
    "field_name",
    "parameter_name",
    "database_name",
    "schema_name",
    "table_name",
    "index_name",
    "stage_name",
    "resource_id",
    "client_id",
    "external_id",
    "request_id",
  ]),
  aliases: {
    role: "aws_iam_role",
    vpc_security_group: "aws_security_group",
    source_security_group: "aws_security_group",
    policy: "aws_iam_policy",
    instance_profile: "aws_iam_instance_profile",
    function: "aws_lambda_function",
    topic: "aws_sns_topic",
    queue: "aws_sqs_queue",
    bucket: "aws_s3_bucket",
    log_group: "aws_cloudwatch_log_group",
    target_group: "aws_lb_target_group",
    load_balancer: "aws_lb",
    certificate: "aws_acm_certificate",
    vpc_endpoint: "aws_vpc_endpoint",
  },
  candidates: (base) => [`aws_${base}`],
};

export const AZURE_RULES: InferenceRules = {
  prefix: "azurerm_",
  suffixes: [
    { suffix: "_ids", targetAttribute: "id", plural: true },
    { suffix: "_names", targetAttribute: "name", plural: true },
    { suffix: "_id", targetAttribute: "id" },
    { suffix: "_name", targetAttribute: "name" },
  ],
  deny: new Set([
    "id",
    "name",
    "location",
    "type",
    "tenant_id",
    "subscription_id",
    "object_id",
    "principal_id",
    "client_id",
    "application_id",
    "display_name",
    "domain_name",
    "user_name",
    "admin_username",
    "database_name",
    "schema_name",
    "table_name",
    "container_name",
    "share_name",
    "queue_name",
    "topic_name",
    "hostname",
  ]),
  aliases: {},
  candidates: (base) => [`azurerm_${base}`],
};

export const GCP_RULES: InferenceRules = {
  prefix: "google_",
  suffixes: [
    // GCP names a reference after the resource itself, with no suffix at all.
    { suffix: "", targetAttribute: "id" },
    { suffix: "_id", targetAttribute: "id" },
  ],
  deny: new Set([
    "id",
    "name",
    "self_link",
    "project",
    "project_id",
    "region",
    "zone",
    "location",
    "description",
    "labels",
    "type",
    "status",
    "state",
    "email",
    "member",
    "role",
  ]),
  /**
   * Cross-product references, which product scoping alone cannot resolve.
   *
   * Networking and identity live in `compute` and the root namespace, but are referenced
   * from every product: a Cloud Run service scopes to `cloud`, so `network` would otherwise
   * look for a non-existent `google_cloud_network`.
   */
  aliases: {
    network: "google_compute_network",
    subnetwork: "google_compute_subnetwork",
    private_network: "google_compute_network",
    // The id is `projects/<p>/serviceAccounts/<email>`; consumers want the bare email.
    service_account: { type: "google_service_account", attribute: "email" },
    kms_key: "google_kms_crypto_key",
    crypto_key: "google_kms_crypto_key",
  },
  /**
   * GCP resources are namespaced by product, and a reference usually stays inside its own
   * product: `google_compute_subnetwork.network` means `google_compute_network`.
   */
  candidates: (base, ownerType) => {
    const [product] = withoutPrefix(ownerType, "google_").split("_");
    const options = [`google_${base}`];
    if (product) options.unshift(`google_${product}_${base}`);
    return options;
  },
};

export const RULES_BY_PROVIDER: Record<string, InferenceRules> = {
  aws: AWS_RULES,
  azure: AZURE_RULES,
  gcp: GCP_RULES,
};

/** Resolves an attribute name to a target resource type, or `undefined` if it is not one. */
function resolveTarget(
  attribute: string,
  ownerType: string,
  knownTypes: ReadonlySet<string>,
  rules: InferenceRules,
): { readonly targetType: string; readonly targetAttribute: string; readonly rule: SuffixRule } | undefined {
  if (rules.deny.has(attribute)) return undefined;

  for (const rule of rules.suffixes) {
    if (rule.suffix && !attribute.endsWith(rule.suffix)) continue;

    const base = rule.suffix ? attribute.slice(0, -rule.suffix.length) : attribute;
    if (!base || rules.deny.has(base)) continue;

    const alias = rules.aliases[base];
    if (rule.aliasOnly && !alias) continue;

    const aliasTarget: AliasTarget | undefined =
      typeof alias === "string" ? { type: alias, attribute: rule.targetAttribute } : alias;
    const options: readonly AliasTarget[] = [
      ...(aliasTarget ? [aliasTarget] : []),
      ...(rule.aliasOnly
        ? []
        : rules
            .candidates(base, ownerType)
            .map((type) => ({ type, attribute: rule.targetAttribute }))),
    ];

    for (const candidate of options) {
      // The safety rail: only a type the provider really has becomes a slot.
      if (candidate.type !== ownerType && knownTypes.has(candidate.type)) {
        return { targetType: candidate.type, targetAttribute: candidate.attribute, rule };
      }
    }
  }

  return undefined;
}

export interface InferResult {
  readonly fields: readonly FieldSchema[];
  readonly slots: readonly ConnectionSlot[];
}

const REFERENCEABLE = new Set(["string", "stringList"]);

/** Names the handle after the resource it accepts, e.g. `aws_iam_role` -> "IAM Role". */
const labelFor = (attribute: string, targetType: string, prefix: string): string =>
  titleCase(withoutPrefix(targetType, prefix)) + (attribute.endsWith("s") ? "s" : "");

/**
 * Walks a resource, promoting reference-shaped attributes to slots.
 *
 * Slot ids must be unique within a resource. When the same attribute name appears in two
 * blocks, the second takes a path-qualified id and records the real attribute separately, so
 * both become usable handles instead of the deeper one being dropped.
 */
export function inferConnections(
  resource: ResourceSchema,
  knownTypes: ReadonlySet<string>,
  rules: InferenceRules,
): InferResult {
  const slots: ConnectionSlot[] = [];
  const usedIds = new Set<string>();

  const walk = (
    fields: readonly FieldSchema[],
    path: readonly string[],
    /** False once any ancestor block is optional. */
    pathRequired: boolean,
  ): readonly FieldSchema[] => {
    const kept: FieldSchema[] = [];

    for (const field of fields) {
      if (field.type === "block") {
        kept.push({
          ...field,
          fields: walk(field.fields ?? [], [...path, field.key], pathRequired && field.required),
        });
        continue;
      }

      if (!REFERENCEABLE.has(field.type)) {
        kept.push(field);
        continue;
      }

      const resolved = resolveTarget(field.key, resource.type, knownTypes, rules);
      if (!resolved) {
        kept.push(field);
        continue;
      }

      // A colliding name keeps the attribute but takes a path-qualified handle id.
      const qualified = [...path, field.key].join(".");
      const slotId = usedIds.has(field.key) ? qualified : field.key;
      if (usedIds.has(slotId)) {
        kept.push(field);
        continue;
      }
      usedIds.add(slotId);
      // Kept as a field as well: the compiler falls back to the literal when the slot is
      // not connected.
      kept.push(field);
      slots.push({
        id: slotId,
        ...(slotId === field.key ? {} : { attribute: field.key }),
        label: labelFor(field.key, resolved.targetType, rules.prefix),
        targetType: resolved.targetType,
        targetAttribute: resolved.targetAttribute,
        cardinality: resolved.rule.plural || field.type === "stringList" ? "many" : "one",
        // Only required if every block on the way here is too: `vpc_config.subnet_ids` is
        // required *within* vpc_config, but vpc_config itself is optional.
        required: field.required && pathRequired,
        ...(path.length > 0 ? { path } : {}),
      });
    }

    return kept;
  };

  return { fields: walk(resource.fields, [], true), slots };
}

export interface InferenceStats {
  readonly resourcesWithSlots: number;
  readonly slotsInferred: number;
  /** Slots by target type, most referenced first — useful for spotting a bad rule. */
  readonly topTargets: readonly (readonly [string, number])[];
}

/** Applies inference across a whole provider. */
export function inferProviderConnections(
  resources: readonly ResourceSchema[],
  rules: InferenceRules,
): { readonly resources: readonly ResourceSchema[]; readonly stats: InferenceStats } {
  const knownTypes = new Set(resources.map((resource) => resource.type));
  const byTarget = new Map<string, number>();

  let resourcesWithSlots = 0;
  let slotsInferred = 0;

  const enriched = resources.map((resource) => {
    const { fields, slots } = inferConnections(resource, knownTypes, rules);
    if (slots.length > 0) resourcesWithSlots += 1;
    slotsInferred += slots.length;
    for (const slot of slots) {
      byTarget.set(slot.targetType, (byTarget.get(slot.targetType) ?? 0) + 1);
    }
    return { ...resource, fields, slots };
  });

  return {
    resources: enriched,
    stats: {
      resourcesWithSlots,
      slotsInferred,
      topTargets: [...byTarget.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    },
  };
}
