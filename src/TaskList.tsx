import React from 'react'
import { Box, Text } from 'ink'
import { getProject, getAgenda } from 'palimpsest'
import type { Task, ProjectionState } from 'palimpsest'

interface Props {
  tasks: Task[]
  selected: number
  state: ProjectionState
  showProject?: boolean
  emptyMessage?: string
}

export function TaskList({ tasks, selected, state, showProject = false, emptyMessage = 'No open tasks.' }: Props) {
  if (tasks.length === 0) return <Text dimColor>{emptyMessage}</Text>

  return (
    <>
      {tasks.map((task, i) => {
        const project = showProject && task.projectId !== undefined ? getProject(state, task.projectId) : undefined
        const agenda = task.agendaId !== undefined ? getAgenda(state, task.agendaId) : undefined
        const isSelected = i === selected
        return (
          <Box key={task.id}>
            <Text {...(isSelected ? { color: 'blue' as const } : {})}>
              {isSelected ? '▶ ' : '  '}
              <Text color="yellow">{task.isNext === true ? '→' : ' '} </Text>{task.title}
              {project !== undefined ? <Text dimColor> · {project.name}</Text> : null}
              {agenda !== undefined ? <Text dimColor> · @{agenda.title}</Text> : null}
              {task.dueDate !== undefined ? <Text dimColor> · due {task.dueDate}</Text> : null}
            </Text>
          </Box>
        )
      })}
    </>
  )
}
