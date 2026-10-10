# ADR 0015 — AI governance: licensing, voice consent, AI labelling and release gates (AI00)

- Status: **Proposed** — needs sign-off by the coordinator (Vinh) and the team
  before AI TTS go-live; §7 lists the decisions only they can make
- Date: 2026-10-10
- Deciders: Công (backend, author), coordinator, Tú (UX/evaluation)
- Related: `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md` (AI00, §3), ADR 0004
  (reviewed audio), ADR 0005 (privacy), ADR 0008–0011, 0013, 0014,
  `docs/runbooks/backend-i04-release-gate.md` (verdict: AI go-live NO-GO until
  this ADR exists)

## Context

The TTS pipeline (worker, Piper voices, admin generation, provenance, kill
switches) is built and gated off. The I04 release gate made AI go-live depend
on three things this repository did not yet record: a commercial-use review per
artifact, an explicit voice-consent rule, and a model release checklist. The
roadmap (AI00) asks for them as an ADR; this is that ADR. It decides policy and
gates. It does not add AI capability.

## Decision

### 1. AI output is always a draft; a human publishes

Already enforced in code, now policy (do not weaken without a new ADR):

- The worker attaches generated audio to a **draft** narration only and never
  submits, approves or publishes (ADR 0014; `TtsJobRunner`).
- Publishing requires the existing human review: an EDITOR submits, a REVIEWER
  or ADMIN approves (ADR 0004 workflow). AI provenance (`audioGeneratedBy`)
  travels with the audio and is shown to the reviewer.
- A narration whose transcript changed after generation is regenerated, never
  silently reused (idempotency key includes `transcriptHash`).
- The transcript stays the visitor fallback; AI audio is never the only content.

### 2. Commercial-use review is per artifact layer

A voice is usable only when **every** layer below permits the intended use.
Licences are copied from each upstream **model card / dataset card**, never
inferred from the engine repository (ADR 0009 §3). The registry
(`config/tts-voices.json`) records the voice-level licence; the table records
the review.

| Layer | What is checked | Where recorded |
|---|---|---|
| Engine/code | Licence of the synthesis engine and how it is distributed (separate process, not linked into the API) | ADR 0009 |
| Weights | Model weights licence, attribution and redistribution terms | voice manifest `license`, `sourceUrl`, `checksum` |
| Training data | Dataset licence and whether speakers consented to synthesis use | this table |
| Voice/speaker | Whether the voice imitates an identifiable real person | this table; §3 |
| Output | Attribution text the published audio must carry | §4 |

Current voices (from `config/tts-voices.json`; **the team must re-check each
card before go-live** — the cards could not be fetched from this environment):

| Locale | Voice | Recorded licence | Attribution needed | Identifiable person? | Review status |
|---|---|---|---|---|---|
| vi | `vi_VN-vais1000-medium` | CC-BY-4.0 (VAIS-1000) | Yes | Dataset speaker; no impersonation intended | To verify |
| en | `en_US-ljspeech-medium` | Public domain (LJ Speech) | No (courtesy credit recommended) | Dataset speaker; no impersonation intended | To verify |
| fr | `fr_FR-siwis-medium` | CC-BY-4.0 (SIWIS) | Yes | Dataset speaker; no impersonation intended | To verify |

A voice with an unset, placeholder or non-commercial licence stays
`enabled: false`; the setup script already refuses unset licences.

### 3. Voice consent and anti-impersonation

- **No cloning or imitation of a real person's voice** (staff, a park MC, a
  public figure, a visitor) without that person's **written consent** that
  names the purpose, the park, the duration and the right to withdraw.
- A consent record (who, scope, date, expiry, withdrawal contact, the
  reference-audio checksum) is stored **outside the repository** with the
  coordinator; the repository stores only its id and checksum.
- Reference audio for cloning is personal data: kept encrypted, access-logged,
  never committed, never sent to a third-party API without the consent naming
  it, and deleted on withdrawal or expiry. Withdrawal disables the voice
  (`enabled: false`) and triggers regeneration of affected drafts/published
  audio with another voice.
- Stock dataset voices are **not** consent to imitate anyone; they are used
  only as generic narrators.
- AI06 (fine-tuning/cloning) stays closed until a GO decision **and** a consent
  record exist (roadmap; ADR 0011).

### 4. AI labelling and attribution

- Admin: every AI draft shows the "AI-generated" warning and provenance
  (provider, model, version, voice, licence) — done (T04, contract v1.1).
- Public API: `audio.generatedBy` is exposed on published narrations
  (contract v1.2) without internal ids.
- Visitor: AI audio carries a visible label ("Giọng đọc do AI tạo" / "AI-generated
  voice") — done in visitor-web. **Open (owner Tú):** voices whose licence
  requires attribution (CC-BY) must also show a credit line, e.g. "Giọng đọc:
  Piper `vi_VN-vais1000` (VAIS-1000, CC BY 4.0)", next to the player or in an
  "About audio" panel. Until it ships, CC-BY voices must not be enabled for
  public audio.

### 5. Privacy and threat review (summary)

| Risk | Control |
|---|---|
| Transcript/prompt leaks into logs/metrics | Never logged or labelled (ADR 0013); stable error codes only |
| Impersonation / deepfake | §3; no cloning without consent; voices pinned by checksum |
| Wrong or offensive audio reaches visitors | Human review gate (§1); transcript fallback |
| Model swapped silently | Pinned `modelVersion` + checksum; registry change is a reviewed commit |
| Resource abuse | Quotas + kill switches (ADR 0013/0014) |
| Licence breach on redistribution | §2 table + §4 attribution before enabling |

### 6. Model release checklist (gate for enabling a voice/model publicly)

A voice/model version may be enabled for public audio only when all hold:

- [ ] §2 review complete for all five layers, recorded in this ADR's table.
- [ ] Weights pinned by immutable version and sha256; source URL recorded.
- [ ] Benchmark run on the T06 corpus with that exact version
      (`data/tts-evaluation`); automated + operational thresholds pass
      (`thresholds.json`, fixed before results).
- [ ] Blind human review: **≥ 3 native raters per locale**, MOS thresholds met,
      0 critical POI-name errors.
- [ ] Attribution line (§4) shipped where the licence requires it.
- [ ] Kill switch and model rollback drilled for this version
      (`backend-ai-operations.md`).
- [ ] No consent record needed (stock voice) **or** a valid consent record (§3).
- [ ] Coordinator sign-off recorded in `docs/STATUS.md`.

## 7. Decisions left to the coordinator/team

1. Who signs consent records and where they are kept.
2. Final wording/placement of the CC-BY attribution in the visitor UI (Tú).
3. Whether the park's commercial context needs a legal review beyond the
   licence text (B01 covers content/map rights; this covers voices).
4. Acceptance of this ADR (status → Accepted).

## Consequences

- AI TTS go-live has a written, checkable gate; the I04 "AI00 missing" blocker
  becomes a sign-off task instead of an unknown.
- Enabling a new voice is a reviewed change with a recorded licence review.
- Some UI work (attribution) is now a precondition for CC-BY voices.
