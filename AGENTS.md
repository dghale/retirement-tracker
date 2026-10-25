# Project Rules & Git Worktree Workflow

## Git Worktrees
This repository uses **git worktrees** for isolated feature development, bug fixes, and parallel agent tasks.

### Guidelines
1. **Worktree Location**: Create all local git worktrees inside the ignored `.worktrees/` directory at the repository root:
   ```powershell
   git worktree add .worktrees/<branch-name> -b <branch-name>
   ```
2. **Main Working Tree**: Keep the root working tree clean on the default branch (`master` / `main`). Perform feature, bugfix, or experimental work inside a dedicated worktree under `.worktrees/<branch-name>`.
3. **Subagent Invocations**: When invoking subagents (`invoke_subagent`) that write code or make isolated changes, pass `Workspace: "share"` (or work within a dedicated `.worktrees/<name>` directory) so each subagent operates in an isolated worktree without conflicting with the main workspace.
4. **Cleanup**: After a branch is merged into the default branch, remove its worktree and delete the branch:
   ```powershell
   git worktree remove .worktrees/<branch-name>
   git branch -d <branch-name>
   ```
