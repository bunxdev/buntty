# Preserve the user's interactive startup before installing command boundaries.
[[ -f ~/.bashrc ]] && source ~/.bashrc
__buntty_saved_prompt=("${PROMPT_COMMAND[@]}")
__buntty_ready=0
__buntty_running=0
__buntty_last_history=$(HISTTIMEFORMAT= builtin history 1)
__buntty_prompt() {
  local code=$?
  __buntty_ready=0
  if [[ $__buntty_running == 1 ]]; then
    printf '\033]777;%s;E;%s\007' "$BUNTTY_LOG_TOKEN" "$code"
    __buntty_running=0
  fi
  local action
  for action in "${__buntty_saved_prompt[@]}"; do
    [[ -n $action ]] && eval "$action"
  done
  __buntty_ready=1
}
__buntty_preexec() {
  [[ $__buntty_ready == 1 && $1 != __buntty_prompt ]] || return 0
  __buntty_ready=0
  __buntty_running=1
  local command
  command=$(HISTTIMEFORMAT= builtin history 1)
  if [[ $command == "$__buntty_last_history" || -z $command ]]; then
    command=$1
  else
    __buntty_last_history=$command
    command=${command#*[0-9]  }
  fi
  printf '\033]777;%s;S;%s\007' "$BUNTTY_LOG_TOKEN" "$(printf '%s' "$command" | base64 -w0)"
}
PROMPT_COMMAND=__buntty_prompt
trap '__buntty_preexec "$BASH_COMMAND"' DEBUG
