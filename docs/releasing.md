# Releasing APIRouter

The version shown by `apirouter --version` and the Dashboard comes from `cli/package.json`; the build copies it to the app package. Development builds use a `-dev.N` suffix.

To publish a stable release, start from the branch you intend to publish. Update `CHANGELOG.md`, then set the same release version in both packages, commit, tag, and push the release:

```bash
npm --prefix cli version 0.5.82 --no-git-tag-version
npm version 0.5.82 --no-git-tag-version
git add cli/package.json cli/package-lock.json package.json package-lock.json CHANGELOG.md
git commit -m "release: v0.5.82"
git tag v0.5.82
git push origin main
git push origin v0.5.82
```

Replace `0.5.82` with the release number, and replace `main` if releasing from another branch. The tag identifies that release; `apirouter update` follows each installation's tracked branch, so the release commit must be pushed to that branch for the update to find it.
