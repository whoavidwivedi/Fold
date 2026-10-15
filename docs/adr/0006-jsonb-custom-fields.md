# 0006 — Custom fields in JSONB, never per-tenant DDL

2026-10-15 · Accepted

## Context

"Every CRM should be fully customizable." Pipedrive supports up to 500 custom fields per
object. Salesforce caps around 100. The naive implementation — a physical column per custom
field — runs `ALTER TABLE` on customer data, which is a production incident waiting for a
Tuesday.

## Decision

**Two mechanisms, chosen by how often they are read.**

**Metadata about fixed fields** → a table, no DDL:

```sql
field_definition (workspace_id, object_type, key, label, data_type,
                  options jsonb, group_name, position, required, visible_roles)
```

This is where label text, ordering, grouping, required-ness and per-role visibility live.
Renaming "Phone" to "Mobile / Direct Line" for one customer is a row update.

**Values of runtime-added fields** → a JSONB column on the entity:

```sql
person (…, data jsonb)   -- custom field values, keyed by field_definition.key
```

Adding a custom field to a customer's workspace is **one row insert**. No migration, ever.

For a field hot enough to need a dedicated index, promote it to a generated column on
demand. Promotion, not up-front migration.

Custom *objects* reuse the same machinery: `object_definition` + a `data jsonb` column on a
generic record table.

**One renderer map drives every surface:**

```tsx
const FIELD_RENDERERS = new Map<FieldType, React.FC<FieldProps>>([...])
```

Table cell, detail form and validation all read the same map. Adding a field type is one map
entry, not fifteen files.

## Alternatives rejected

**A physical column per custom field** (Twenty CRM, and to a degree Frappe). Twenty runs
`ALTER TABLE` inside the tenant's own schema, which is why they chose schema-per-tenant —
the DDL lock is isolated. We chose shared schema + RLS, so this path is closed to us. It also
means `CREATE TABLE` storms, migration coordination across replicas, and a hard ceiling on
field count per workspace.

**EAV — one row per value.** Schema-stable, but every whole-record fetch becomes an N+1 or
an aggregating join. Correct for infinite sparsity, wrong for a CRM where records are read
whole, constantly.

## Consequences

- **Loses** per-field foreign keys, and per-field column statistics for the planner.
  Filtering uses expression or GIN indexes: `data->>'score' > '5'`.
- Querying a rare custom field in a hot list view is slower than a physical column. This is
  the real cost, and promotion to a generated column is the escape hatch.
- Because metadata is data, an AI agent can author and edit custom fields through the same
  CRUD surface a human uses. No code generation, no deploy. That is the single biggest
  reason this is the right shape for us.