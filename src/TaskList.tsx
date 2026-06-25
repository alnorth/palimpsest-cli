import React from 'react'
import { Text } from 'ink'
import { getProject, getAgenda } from 'palimpsest'
import type { Task, ProjectionState } from 'palimpsest'
import { Row, Meta } from './Row.js'
import { formatDateTime } from './format.js'

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
          <Row
            key={task.id}
            isSelected={isSelected}
            color={isSelected ? 'blue' : undefined}
            title={<><Text color="yellow">{task.isNext === true ? '→' : ' '} </Text>{task.title}</>}
          >
            {project !== undefined ? <Meta>{project.name}</Meta> : null}
            {agenda !== undefined ? <Meta>@{agenda.title}</Meta> : null}
            {task.dueDate !== undefined ? <Meta>due {task.dueDate}</Meta> : null}
            {task.completedAt !== undefined ? <Meta>{formatDateTime(task.completedAt)}</Meta> : null}
          </Row>
        )
      })}
    </>
  )
}
