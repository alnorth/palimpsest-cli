import React from 'react'
import { Box, Text } from 'ink'
import { getProject } from 'palimpsest'
import type { Task, ProjectionState } from 'palimpsest'

interface Props {
  tasks: Task[]
  selected: number
  state: ProjectionState
  showProject?: boolean
}

export function TaskList({ tasks, selected, state, showProject = false }: Props) {
  if (tasks.length === 0) return <Text dimColor>No open tasks.</Text>

  return (
    <>
      {tasks.map((task, i) => {
        const project = showProject && task.projectId !== undefined ? getProject(state, task.projectId) : undefined
        const isSelected = i === selected
        return (
          <Box key={task.id}>
            <Text {...(isSelected ? { color: 'blue' as const } : {})}>
              {isSelected ? '▶ ' : '  '}
              {task.isNext === true ? <Text color="yellow">→ </Text> : null}{task.title}
              {project !== undefined ? <Text dimColor> · {project.name}</Text> : null}
              {task.dueDate !== undefined ? <Text dimColor> · due {task.dueDate}</Text> : null}
            </Text>
          </Box>
        )
      })}
    </>
  )
}
