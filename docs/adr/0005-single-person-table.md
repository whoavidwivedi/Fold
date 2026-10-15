# 0005 — One `person` table, no lead/contact split

2026-10-15 · Accepted

## Context

Salesforce, HubSpot, EspoCRM and Frappe all maintain a separate `Lead` table that converts
into a `Contact`. Three of the four modern products do not.

## Decision

**One `person` table. Qualification is a field (`lifecycle_stage`), not a different entity.**

```sql
person (id, workspace_id, first_name, last_name, lifecycle_stage, …)
-- lifecycle_stage: new → contacted → qualified → customer → disqualified
```

The UI labels this "Leads" in a rep's work queue and "Contacts" elsewhere, depending on which
stage filter is active. The stored concept is one.

A person has many deals. `deal.person_id` is a plain foreign key.

## Alternatives rejected

**Separate `lead` and `contact` tables.** Surveyed market:

| Product | Separate Lead object? |
| --- | --- |
| Twenty CRM | No — `Person` + `personType` field |
| HubSpot | No — `lifecyclestage` property |
| Attio | No — people + list entries |
| Salesforce / Espo / Frappe | Yes — legacy |

The split exists in Salesforce and HubSpot because of how they grew up, not because it is
better. Migration writeups name lead/contact reconciliation as **the single largest risk**
when moving data between CRMs. We have no legacy, so we decline to inherit the problem.

The split would cost us: a table, a conversion flow, a deduplication problem (the same human
arriving twice, pre- and post-conversion), and a class of "which record do I show" bug in
search and reporting.

## Consequences

- No lead-to-contact conversion UI, mapping table, or data migration path. Conversion is an
  `UPDATE` setting `lifecycle_stage`.
- Disqualified leads stay in the same table. Filtering by stage is how you get "the leads I
  actually care about".
- Import tooling normalizes a single shape. Importing the same person twice updates in place
  rather than creating a duplicate that needs merging.
- Marketing-style "lead" objects that are really campaign events (form fills, ad clicks) are
  modelled as `event` rows plus `person.source`, not as separate entities.