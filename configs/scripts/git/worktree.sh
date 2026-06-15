#!/bin/bash

# add git worktree with branch
function gwoa() {
	branch=$(select_branch)
	mkdir -p ~/worktrees # 디렉터리 없으면 생성
	git worktree add "$HOME/worktrees/$branch" "$branch"
	gum format -- "**$branch** 워크트리 생성"
}

# remove git worktree
function gwor() {
	branch=$(select_branch)
	git worktree remove "$branch"
	gum format -- "**$branch** 워크트리 삭제"
}

# checkout git worktree
gwcd() {
  local selected
  selected=$(git worktree list | fzf --with-nth=3.. --prompt="worktree> ") || return
  cd "$(awk '{print $1}' <<< "$selected")"
}

# remove merged branch & worktrees
gwrm() {
	PROTECTED='^(main|master|develop|staging|production|stag|prod)$'
	BASE="${1:-main}"

	git fetch --prune

	branches=$(
		git branch --merged "$BASE" \
			| sed 's/^[*+ ]*//' \
			| grep -vE "$PROTECTED" \
			| grep -v "^$BASE$" \
			|| true
	)

	if [ -z "$branches" ]; then
		echo "정리할 머지된 브랜치 없음."
		return 0
	fi

	while IFS= read -r branch; do
		[ -z "$branch" ] && continue

		wt_path=$(git worktree list --porcelain \
			| awk -v b="refs/heads/$branch" '
					/^worktree / { path=$2 }
					/^branch /   { if ($2 == b) print path }
				')

		if [ -n "$wt_path" ]; then
			echo "🌳 worktree 삭제: $wt_path  (branch: $branch)"
			git worktree remove "$wt_path" --force
		fi

		echo "🪓 branch 삭제: $branch"
		git branch -d "$branch"
	done <<< "$branches"

	git worktree prune
}
