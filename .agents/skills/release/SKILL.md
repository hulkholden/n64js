---
name: release
description: Prepare an n64js release by tagging a specified revision (HEAD by default), pushing the tag, and drafting Markdown release notes covering user-facing changes since the previous release. Also supports release-notes-only requests.
---

# n64js release

For the full workflow, create and push an annotated release tag, then return copyable release notes in a Markdown code block. A request to run this workflow authorizes the tag and push; do not ask for redundant confirmation. Respect narrower requests for only notes or tagging. Do not publish a GitHub Release unless requested.

## Resolve the release

- Require a release version from the user; use the repository's `v` prefix (for example, `1.0.3` becomes `v1.0.3`). Do not guess the next version.
- Resolve the specified revision to an exact commit. If omitted, resolve the current checkout's `HEAD`, including a detached HEAD. Do not substitute the remote default branch or commit uncommitted changes.
- Inspect remotes and existing local and remote release tags. Default to `origin` unless the user specifies another remote. Fetch a missing target commit and tags needed for comparison. A network failure is not evidence that a tag is absent.
- Use the user's comparison tag if supplied. Otherwise choose the preceding release tag in version order that is an ancestor of the target commit. Check history for ambiguity, especially maintenance branches or prereleases; ask only if a meaningful choice remains unresolved. For a first release, summarize history through the target and omit the comparison link.

## Tag and push

1. Validate the tag name with `git check-ref-format` and verify the revision resolves to a commit before mutating refs.
2. Create an annotated tag at the resolved commit with message `Release VERSION`, following the existing `v1.0.x` convention. Replace `VERSION` with the actual tag name.
3. Push only `refs/tags/VERSION` to the selected remote. Do not push branches or all tags.
4. Verify the remote tag's peeled commit matches the requested commit using `git ls-remote`, including the `^{}` ref for an annotated tag.

Never force-push, delete, or move an existing release tag. If the tag already exists at the intended commit, reuse it and complete any missing push. If local and remote tag objects differ, or either resolves to another commit, stop and report the conflict. After an uncertain push result, inspect the remote before retrying. Report partial completion accurately if pushing or verification fails.

## Draft release notes

Read commit subjects and full messages for `PREVIOUS..VERSION`, then inspect relevant diffs and available validation evidence. Do not rely on subjects alone: refactoring commits can contain user-visible fixes, and compatibility claims often have important limits. Use the release tag as the upper bound even if the working tree has advanced.

- Include observable improvements to game startup, graphics, audio, performance, saves, controls, UI, and debugging tools.
- Exclude dependency removal (such as removing jQuery), internal migrations, cleanup, test/build infrastructure, and implementation details without a user-facing outcome.
- Name affected games when supported by the evidence. Describe what now works rather than the underlying code changes.
- Distinguish reaching a title screen or progressing further from full playability. Retain material known limitations. Do not turn headless execution or synthetic tests into claims of verified visual correctness.
- Combine related changes into concise bullets. Include behavioral fixes embedded in refactoring commits without mentioning the refactoring itself.
- Follow the structure below, omitting empty sections. Place brief compatibility or latency caveats after the relevant bullets when supported. Do not invent claims to fill the template.
- End with a full changelog link using the selected repository's GitHub URL and exact comparison tags.

```markdown
# n64js VERSION

## Compatibility

- Describe startup or progression improvements and affected games.

## Graphics

- Describe visible rendering fixes and graphics support.

## Audio

- Describe playback improvements.

## Performance

- Describe speed, frame pacing, or stutter improvements.

## Misc

- Describe save, controller, UI, or debugger improvements.

[Full changelog](https://github.com/hulkholden/n64js/compare/PREVIOUS...VERSION)
```

Return the Markdown directly for copying unless the user requests a file. For the full workflow, also briefly confirm the pushed tag and target commit outside the code block. Do not run emulator tests merely to draft notes or tag an existing commit; use existing evidence and state its limits where material.
