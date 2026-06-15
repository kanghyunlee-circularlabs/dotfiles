# .zshrc에 추가
remind() {
	(sleep $1 && terminal-notifier -title "리마인더" -message "$2" -sound glass) &
	disown
}

