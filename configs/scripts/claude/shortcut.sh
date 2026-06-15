function cl() {
	claude
}

function cla() {
	claude agents
}

function cld() {
	claude --dangerously-skip-permissions
}

function clb() {
	prompt=$(gum write --placeholder "에이전트에게 시킬 프롬프트")
	if [ -z "$prompt" ]; then
		return 
	fi
	claude --bg "$prompt"
}
