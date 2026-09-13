    {
      "schema": "gentle-ai.sdd-preproposal/v1",
      "revision": 4,
      "supersedes_revision": 3,
      "bootstrap": false,
      "change": "d200-plugin-scaffold",
      "worktree": "/mnt/d/Desarrollo/SportBoardPlugin",
      "store": "openspec",
      "product_decision_handoff": {
        "kind": "product-decision-handoff",
        "sources_collected": false,
        "source_calls_made": [],
        "evidence_meaning_altered": false,
        "research_recollected": false,
        "authority": "User-confirmed product decisions relayed by the parent. This research child records them and makes no product choice of its own; the orchestrator owns product decisions and proposal admission.",
        "preserved": ["research_request", "admission_outcome", "evidence_refs", "claim_index", "residual_gaps", "handoff_notes", "exploration_ref", "readiness_only_reconciliation"],
        "confirmed_decisions": [
          {
            "id": "D1",
            "status": "confirmed",
            "decision": "CommonJS, zero runtime dependencies, modeled on FlightInfo.",
            "constraints": ["CommonJS module format", "no runtime npm dependencies", "FlightInfoPlugin (one-action CJS D200 plugin, hand-rolled WS/ZIP) as the structural model"],
            "evidence_context": ["C15", "C16", "C7", "C8", "C17"],
            "divergence_note": "The documented vendor Node SDK path (ulanzideck-api 0.1.0) is an ES module that depends on ws ^8.18.0 (C15/S4) and is unpublished on npm (C16/S7). The confirmed choice therefore cannot consume that SDK as published; the plugin must implement the host protocol itself, as the exploration's FlightInfo template does. Recorded as a product choice; no claim changed."
          },
          {
            "id": "D2",
            "status": "confirmed",
            "decision": "Automated checks plus a documented UlanziDeck Simulator recipe, without hardware acceptance dependency.",
            "constraints": ["automated checks (manifest gate, syntax sweep, node:test suite)", "documented simulator run recipe for manual verification", "no physical D200 acceptance run as a completion gate"],
            "evidence_context": ["C17", "C18", "C19", "C20", "G1", "G3"],
            "divergence_note": "The simulator is documented as a partial, reference-only ergonomics surface (C18: no setactive events, no page switching, manual main-service start) and the production install folder stays undocumented (G1). Because hardware acceptance is explicitly not a gate, G1 and G3 become non-blocking notes for this slice rather than verification blockers."
          },
          {
            "id": "D3",
            "status": "confirmed",
            "decision": "One D200 action with a static icon/state only; no dynamic SVG and no network.",
            "constraints": ["exactly one action", "static manifest icon/state rendering only (no dynamic SVG/image data payloads)", "no outbound network calls at runtime"],
            "evidence_context": ["C3", "C4", "C6", "C10", "C11"],
            "divergence_note": "Dynamic icon/title commands exist and are documented (C10, with V3.1 commands gated on UlanziStudio 3.3.0+), and the validated Q4-Q6 TheSportsDB evidence (base URL, response shapes, 30 rpm limit, credential exposure) is not consumed by this slice because no network path is in scope. That evidence remains validated and carried for later slices."
          },
          {
            "id": "D4",
            "status": "confirmed",
            "decision": "Defer Property Inspector entirely.",
            "constraints": ["no inspector page or PropertyInspectorPath entry in this slice", "no inspector-to-service channel", "no RandomPort usage"],
            "evidence_context": ["C1", "C13", "C8"],
            "divergence_note": "C1 lists property-inspector/ in the documented package layout and C13 documents RandomPort for direct inspector-to-service talk. Both are removed from this slice's scope by the deferral; C1/C13 remain accurate evidence."
          }
        ],
        "scope_and_non_goals": {
          "in_scope": [
            "A single D200 action implemented in a CommonJS, zero-runtime-dependency plugin package modeled on FlightInfoPlugin.",
            "Static icon/state rendering for that one action (manifest States plus static assets).",
            "Manifest and package skeleton that satisfies the documented required fields (C2, C3, C4) and the repo's configured commands (check/test/build/package as planned in openspec/config.yaml).",
            "Automated checks and a documented UlanziDeck Simulator verification recipe as the acceptance path."
          ],
          "non_goals": [
            "Any network access or external data source: TheSportsDB live scores (Q4-Q6 evidence) are out of this slice.",
            "Dynamic content rendering: no generated SVG, no base64 image payloads, no dynamic titles.",
            "Property Inspector UI of any kind (deferred entirely).",
            "Hardware acceptance on a physical D200 as a gate.",
            "Determining the production install folder path (G1) and store submission layout (exploration U10).",
            "V3.1-only host display commands and the host-version question behind them (G3 stays carried)."
          ],
          "deferred_to_later_slices": [
            "Property Inspector settings surface (D4).",
            "Dynamic icon/title rendering and any network-backed content, including the already-validated TheSportsDB findings (D3).",
            "Publication gates: store metadata, localization, third-party license notices (exploration budget note)."
          ]
        },
        "readback_and_verification": {
          "method": "Full bounded write of this artifact plus a full post-write read; the research artifact was read in full, re-persisted by full bounded write at revision 6 for a matching readiness record, and read back in full. No source was fetched and no claim, excerpt, URL, provenance or gap was edited in this pass.",
          "digest_verification": "unavailable: this child has no shell/hash/code tool, so the carried SHA-256 digests (explore 6510a57a…, research f026066b…, preproposal fb85be06…) were not recomputed; identity rests on the carried revision plus content inspection, as in prior revisions.",
          "readiness_change": "product_decisions confirmed and proposal_ready set to true because evidence for Q1-Q6 is complete for both selected classes with no blocked or partial class."
        }
      },
      "readiness_only_reconciliation": {
        "kind": "readiness-only",
        "sources_collected": false,
        "source_calls_made": [],
        "evidence_meaning_altered": false,
        "preserved": ["research_request", "admission_outcome", "evidence_refs", "claim_index", "residual_gaps", "handoff_notes"],
        "trigger": "Prior launch timed out before any turn or tool call; this pass read all three carried locators with the read tool only and re-collected nothing.",
        "reads": {
          "explore": "ok (carried revision 1; the exploration file has no in-file revision field)",
          "research": "ok (carried revision 4, file declared revision 4)",
          "preproposal": "ok (carried revision 2, file declared revision 2)"
        },
        "digest_verification": "unavailable: this child has no shell/hash/code tool, so the carried SHA-256 digests (explore 6510a57a…, research 01231d9f…, preproposal 1588b44b…) could not be recomputed; identity rests on declared revision plus content inspection",
        "readiness_change": "proposal_ready set to false because product_decisions is pending; admission_outcome and every evidence reference are unchanged."
      },
      "exploration_ref": {
        "path": "openspec/changes/d200-plugin-scaffold/explore.md",
        "carried_revision": 1,
        "carried_digest": "6510a57aadd8d249731d8c454615caf06a7575952e1f5bb311adadd30c27b607",
        "readback": "ok (read in full this pass; exploration files have no in-file revision field)",
        "digest_verification": "unavailable (no shell/hash/code tool in this child); identity asserted on declared revision plus content inspection"
      },
      "research_ref": {
        "path": "openspec/changes/d200-plugin-scaffold/research.md",
        "revision": 6,
        "supersedes_revision": 5,
        "carried_revision": 5,
        "carried_digest": "f026066b016f25285f3e6d58f349f38502e31dfcba78313066df428e68060d3f",
        "schema": "gentle-ai.sdd-research/v1",
        "outcome": "done",
        "readback": "ok (post-write readback: revision 6, outcome done, product_decisions confirmed, proposal_ready true; sources S1-S26, claims C1-C40, questions Q1-Q6 and gaps G1-G3 intact)",
        "readback_note": "The environment advisory message 'Research readback incomplete: proposal_ready=false' still appeared on the research read and matches the pre-write state of this artifact (revision 3, product_decisions pending); the observed research content itself declares revision 6 with proposal_ready true and no blocked or partial class."
      },
      "research_request": {
        "classes": ["documentation", "open-web"],
        "questions": [
          { "id": "Q1", "class": "documentation", "text": "Exact UlanziStudio (Ulanzi Deck) plugin package contract for the D200: directory layout, manifest/property-inspector schema, required fields and supported action types.", "status": "answered" },
          { "id": "Q2", "class": "documentation", "text": "How an UlanziStudio plugin receives actions, renders dynamic button titles/icons, and communicates with an external backend on the D200.", "status": "answered" },
          { "id": "Q3", "class": "documentation", "text": "Runtimes, toolchain versions and local validation/sideload requirements for UlanziStudio plugin development on the D200.", "status": "answered" },
          { "id": "Q4", "class": "open-web", "text": "TheSportsDB free/development endpoints for live scores and events, base URL, and how the free/test key is supplied per sport (football default plus configurable sport).", "status": "answered" },
          { "id": "Q5", "class": "open-web", "text": "Exact response shapes of the relevant TheSportsDB live-event endpoints (field names, nullability, live-progress vs finished state fields).", "status": "answered" },
          { "id": "Q6", "class": "open-web", "text": "Rate limits and polling constraints on TheSportsDB free/development keys, and the credential-handling constraints that follow (key in URL vs header, secret exposure in a distributed package, caching).", "status": "answered" }
        ]
      },
      "admission_outcome": {
        "overall": "executed",
        "documentation": {
          "status": "executed",
          "tools": ["fetch_content"],
          "required_tools": ["fetch_content"],
          "claims_validated": 21,
          "evidence_ready": true
        },
        "open-web": {
          "status": "executed",
          "tools": ["web_search", "source_check", "fetch_content", "get_search_content"],
          "required_tools": ["web_search", "source_check", "fetch_content", "get_search_content"],
          "claims_validated": 19,
          "evidence_ready": true
        },
        "blocked_or_partial_classes": [],
        "failed_calls_recorded": 7,
        "note": "Revisions 1-3 reported both classes blocked because the evidence tools were absent; in this child all approved tools were present and were actually executed, and this corrected capability fact was recorded within the identical store/worktree/change bounds."
      },
      "evidence_refs": [
        { "ref": "S1", "kind": "official-vendor-doc", "publisher": "UlanziTechnology/UlanziDeckPlugin-SDK", "url": "https://raw.githubusercontent.com/UlanziTechnology/UlanziDeckPlugin-SDK/main/README.md", "supports": ["Q1", "Q3"] },
        { "ref": "S2", "kind": "official-vendor-doc", "publisher": "UlanziTechnology/UlanziDeckPlugin-SDK", "url": "https://raw.githubusercontent.com/UlanziTechnology/UlanziDeckPlugin-SDK/main/manifest.md", "supports": ["Q1", "Q3"], "provenance": "sha 1a286d06205fd231a38918808864add1ada6a575, size 12240, confirmed via GitHub contents API" },
        { "ref": "S3", "kind": "official-vendor-doc", "publisher": "UlanziTechnology/plugin-common-node", "url": "https://raw.githubusercontent.com/UlanziTechnology/plugin-common-node/main/README.md", "supports": ["Q2", "Q3"] },
        { "ref": "S4", "kind": "official-vendor-manifest", "publisher": "UlanziTechnology/plugin-common-node", "url": "https://raw.githubusercontent.com/UlanziTechnology/plugin-common-node/main/package.json", "supports": ["Q3"] },
        { "ref": "S5", "kind": "official-vendor-doc", "publisher": "UlanziTechnology (UlanziDeckSimulator)", "url": "https://raw.githubusercontent.com/UlanziTechnology/UlanziDeckPlugin-SDK/main/UlanziDeckSimulator/README.md", "supports": ["Q3"] },
        { "ref": "S6", "kind": "official-vendor-sample", "publisher": "UlanziTechnology (APIRequest demo)", "url": "https://raw.githubusercontent.com/UlanziTechnology/UlanziDeckPlugin-SDK/main/demo/com.ulanzi.APIRequest.ulanziPlugin/README.md", "supports": ["Q2", "Q3"] },
        { "ref": "S7", "kind": "registry-metadata", "publisher": "npm registry", "url": "https://registry.npmjs.org/ulanzideck-api", "supports": ["Q3"], "result": "HTTP 404" },
        { "ref": "S8", "kind": "repo-metadata", "publisher": "GitHub REST API", "url": "https://api.github.com/repos/UlanziTechnology/UlanziDeckPlugin-SDK/contents/?ref=main", "supports": ["Q1", "Q3"] },
        { "ref": "S9", "kind": "official-api-doc", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/documentation", "supports": ["Q4", "Q5", "Q6"] },
        { "ref": "S10", "kind": "official-api-doc", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/docs_api_data", "supports": ["Q5"] },
        { "ref": "S11", "kind": "official-api-doc", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/docs_api_testing", "supports": ["Q4", "Q6"] },
        { "ref": "S12", "kind": "official-api-doc", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/free_sports_api", "supports": ["Q4", "Q6"] },
        { "ref": "S13", "kind": "live-endpoint-probe", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Soccer", "supports": ["Q4", "Q5"], "result": "HTTP 200, 88191 chars" },
        { "ref": "S14", "kind": "live-endpoint-probe", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/api/v1/json/123/livescore.php?s=Soccer", "supports": ["Q4"], "result": "HTTP 200, 88191 chars" },
        { "ref": "S15", "kind": "live-endpoint-probe", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/api/v1/json/3/livescore.php?s=Basketball", "supports": ["Q4", "Q5"], "result": "HTTP 200, includes NS record with null score/progress" },
        { "ref": "S16", "kind": "live-endpoint-probe", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=2026-09-13&s=Soccer", "supports": ["Q5"], "result": "HTTP 200, 3 events" },
        { "ref": "S17", "kind": "live-endpoint-probe", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=2405076", "supports": ["Q5"] },
        { "ref": "S18", "kind": "live-endpoint-probe", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4328", "supports": ["Q5"] },
        { "ref": "S19", "kind": "live-endpoint-probe", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/api/v2/json/livescore/soccer", "supports": ["Q4"], "result": "HTTP 400 without X-API-KEY" },
        { "ref": "S20", "kind": "official-static-example", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/api/v2/examples/livescore_sport.json", "supports": ["Q5"] },
        { "ref": "S21", "kind": "live-endpoint-probe", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/api/v1/json/3/eventsseason.php?id=4328&s=2025-2026", "supports": ["Q5"], "result": "HTTP 200, 5 events for a full season" },
        { "ref": "S22", "kind": "repo-metadata", "publisher": "GitHub REST API", "url": "https://api.github.com/repos/UlanziTechnology/UlanziDeckPlugin-SDK/git/trees/main?recursive=1", "supports": ["Q1", "Q3"] },
        { "ref": "S23", "kind": "official-vendor-config", "publisher": "UlanziTechnology/UlanziDeckPlugin-SDK", "url": "https://raw.githubusercontent.com/UlanziTechnology/UlanziDeckPlugin-SDK/main/.gitmodules", "supports": ["Q3"] },
        { "ref": "S24", "kind": "official-api-doc", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/docs_api_examples", "supports": ["Q4", "Q6"] },
        { "ref": "S25", "kind": "search-corpus", "publisher": "web_search / source_check", "url": "responseIds mu08hkfqw63m5x, mu08ieljq6eopt, mu08joyh32sp4v, mu08k5xsnysv43", "supports": ["routing-only"], "note": "No claim rests on a snippet; source_check returned missing-evidence/unclear for facts stated verbatim on the official pages it listed." },
        { "ref": "S26", "kind": "failed-retrieval", "publisher": "TheSportsDB.com", "url": "https://www.thesportsdb.com/pricing and https://www.thesportsdb.com/docs_pricing", "supports": ["Q6"], "result": "extraction-incomplete; premium statement taken from S12" }
      ],
      "claim_index": {
        "Q1": ["C1", "C2", "C3", "C4", "C5", "C6"],
        "Q2": ["C9", "C10", "C11", "C12", "C13", "C14"],
        "Q3": ["C7", "C8", "C15", "C16", "C17", "C18", "C19", "C20", "C21"],
        "Q4": ["C22", "C23", "C24", "C25", "C26"],
        "Q5": ["C27", "C28", "C29", "C30", "C31", "C32", "C33", "C34", "C35"],
        "Q6": ["C36", "C37", "C38", "C39", "C40"]
      },
      "residual_gaps": [
        { "id": "G1", "question": "Q3", "gap": "Production install folder path is undocumented (C21).", "status_with_confirmed_decisions": "carried, non-blocking for this slice: no hardware installation gate (D2)." },
        { "id": "G2", "question": "Q6", "gap": "No official caching policy statement exists in the retrieved corpus (C40).", "status_with_confirmed_decisions": "carried, not exercised by this slice: no network path is in scope (D3)." },
        { "id": "G3", "question": "Q2/Q3", "gap": "The user's installed UlanziStudio version is unknown, so V3.1 command availability (3.3.0+) cannot be settled from documentation.", "status_with_confirmed_decisions": "carried, not exercised by this slice: static icon/state only, no V3.1 display commands (D3)." }
      ],
      "handoff_notes": [
        "Explore unknowns resolved by this research: U1, U2, U4, U9 fully; U8 partially (Apache-2.0, separate upstream repo); U3 documented as a host-version question (V3.1 needs UlanziStudio 3.3.0+).",
        "Not covered and still open from the exploration: U5 (hardware SVG raster behaviour), U6 (statelist.type semantics), U7 (paramfromplugin size limits), U10 (store submission layout). They were outside the selected Q1-Q6 scope. U5 and U7 lose practical weight under D3/D4 but are not resolved.",
        "Evidence constrain the live-event data source: free-tier event queries are truncated (C35), and documented field semantics disagree with the live feed (C29). This evidence is validated but out of this slice's scope under D3.",
        "The confirmed D1/D2 choices align with the exploration's strategy A (FlightInfo copy build, zero deps) and its verification-without-hardware option (simulator recipe).",
        "The exploration's review-budget finding still applies: a faithful scaffold was estimated at roughly 700-1050 changed lines across 3 slices, so the delivery decision and any chaining remain the orchestrator's, not derived here."
      ],
      "product_decisions": "confirmed",
      "proposal_ready": true,
      "proposal_ready_scope": "Research evidence for Q1-Q6 remains complete for both selected classes with no blocked or partial class, and this handoff pass changed no evidence, claim, URL, excerpt, provenance or gap: it added confirmed product decisions, scope and non-goals only. proposal_ready is true because product_decisions is confirmed (user, relayed by the parent) and no class is blocked or partial, so the orchestrator's proposal-admission gate is satisfied for this readiness record; the research artifact was re-persisted to revision 6 with the matching product_decisions=confirmed / proposal_ready=true readiness record. Gaps G1-G3 are carried forward explicitly and are non-blocking under the confirmed decisions. Product choices remain orchestrator-owned and are recorded here; they are not derived from the evidence by this child.",
      "notes": "This is a pre-proposal research state artifact only. It contains no proposal content, no design and no implementation, and it does not authorize a proposal by itself. Revision 4 records the user-confirmed product-decision handoff (D1-D4) plus the resulting scope and non-goals, with all evidence from revisions 1-3 preserved unchanged. Delivery strategy, chaining and review-budget decisions are outside this artifact."
    }
