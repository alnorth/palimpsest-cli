import React, { useState, useMemo } from 'react'
import { render, Box, Text, useInput, useApp, useWindowSize } from 'ink'
import { TaskList } from './TaskList.js'
import { Row, Meta } from './Row.js'
import TextInput from 'ink-text-input'
import {
  PalimpsestStore, CLEAR,
  listTasks, listProjects, listSpheres, listAgendas,
  createTask, updateTask, completeTask, createProject, updateProject, archiveProject, unarchiveProject, createSphere, createAgenda,
} from 'palimpsest'
import type { ProjectionState, SphereId, ProjectId } from 'palimpsest'
import { formatDate } from './format.js'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

const filePath = process.env['PALIMPSEST_FILE'] ?? join(homedir(), '.palimpsest', 'events.jsonl')
mkdirSync(dirname(filePath), { recursive: true })
const store = new PalimpsestStore(filePath)

type View = 'tasks' | 'projects' | 'project'
type Mode = 'list' | 'picking-view' | 'adding' | 'editing-task' | 'picking-agenda-for-task' | 'adding-project' | 'editing-project' | 'settings' | 'creating-sphere' | 'picking-sphere-for-agenda' | 'creating-agenda'

const VIEW_CONFIG = {
  tasks:    { label: 'Tasks',    key: 't', hasTasks: true  },
  projects: { label: 'Projects', key: 'p', hasTasks: false },
  project:  { label: 'Project',            hasTasks: true  },
} satisfies Record<View, { label: string; key?: string; hasTasks: boolean }>

const TOP_LEVEL_VIEWS = (['tasks', 'projects'] as const).filter(v => VIEW_CONFIG[v].key !== undefined)
const SETTINGS_OPTIONS = ['Create Sphere', 'Create Agenda'] as const

function App() {
  const [state, setState] = useState<ProjectionState>(() => store.getState())
  const spheres = useMemo(() => listSpheres(state), [state])
  const [currentSphereId, setCurrentSphereId] = useState<SphereId | undefined>(() => store.getState().spheres.values().next().value?.id)
  const activeSphere = useMemo(
    () => (currentSphereId !== undefined ? state.spheres.get(currentSphereId) : undefined) ?? spheres[0],
    [state, currentSphereId, spheres],
  )
  const [showCompleted, setShowCompleted] = useState(false)
  const tasks = useMemo(() => {
    if (activeSphere === undefined) return []
    const result = listTasks(state, { sphereId: activeSphere.id, status: showCompleted ? 'completed' : 'open' })
    if (showCompleted) result.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    return result
  }, [state, activeSphere, showCompleted])
  const [showArchived, setShowArchived] = useState(false)
  const projects = useMemo(() => {
    if (activeSphere === undefined) return []
    const result = listProjects(state, { sphereId: activeSphere.id, isArchived: showArchived })
    if (showArchived) result.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
    return result
  }, [state, activeSphere, showArchived])
  const agendas = useMemo(
    () => activeSphere !== undefined ? listAgendas(state, { sphereId: activeSphere.id }) : [],
    [state, activeSphere],
  )
  const projectStats = useMemo(() => {
    const hasNext = new Set<ProjectId>()
    const taskCount = new Map<ProjectId, number>()
    for (const task of state.tasks.values()) {
      if (task.projectId !== undefined && task.status === 'open') {
        taskCount.set(task.projectId, (taskCount.get(task.projectId) ?? 0) + 1)
        if (task.isNext === true) hasNext.add(task.projectId)
      }
    }
    return { hasNext, taskCount }
  }, [state])
  const [view, setView] = useState<View>('tasks')
  const [activeProjectId, setActiveProjectId] = useState<ProjectId | undefined>(undefined)
  const activeProject = useMemo(
    () => activeProjectId !== undefined ? state.projects.get(activeProjectId) : undefined,
    [state, activeProjectId],
  )
  const projectTasks = useMemo(() => {
    if (activeProjectId === undefined) return []
    const result = listTasks(state, { projectId: activeProjectId, status: showCompleted ? 'completed' : 'open' })
    if (showCompleted) result.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    return result
  }, [state, activeProjectId, showCompleted])
  const [selected, setSelected] = useState(0)
  const [viewPickerSelected, setViewPickerSelected] = useState(0)
  const [agendaPickerSelected, setAgendaPickerSelected] = useState(0)
  const [settingsSelected, setSettingsSelected] = useState(0)
  const [pickerSelected, setPickerSelected] = useState(0)
  const [agendaSphereId, setAgendaSphereId] = useState<SphereId | undefined>(undefined)
  const [mode, setMode] = useState<Mode>('list')
  const [formValue, setFormValue] = useState('')
  const { exit } = useApp()
  const { rows: termRows } = useWindowSize()

  const listLength = view === 'tasks' ? tasks.length : view === 'projects' ? projects.length : projectTasks.length

  function refreshState() {
    const newState = store.getState()
    setState(newState)
    return newState
  }

  function appendAndRefresh(events: ReturnType<typeof createTask>) {
    store.appendEvents(events)
    refreshState()
  }

  function startCreateAgenda() {
    if (spheres.length === 0) {
      setMode('picking-sphere-for-agenda')
    } else if (spheres.length === 1) {
      setAgendaSphereId(spheres[0]!.id)
      setMode('creating-agenda')
    } else {
      setPickerSelected(0)
      setMode('picking-sphere-for-agenda')
    }
  }

  useInput((input, key) => {
    if (mode === 'adding' || mode === 'editing-task' || mode === 'adding-project' || mode === 'editing-project' || mode === 'creating-sphere' || mode === 'creating-agenda') {
      if (key.escape) {
        setFormValue('')
        setMode(mode === 'creating-sphere' || mode === 'creating-agenda' ? 'settings' : 'list')
      }
      return
    }
    if (mode === 'picking-view') {
      if (key.escape) { setMode('list'); return }
      if (key.upArrow) setViewPickerSelected(i => Math.max(0, i - 1))
      if (key.downArrow) setViewPickerSelected(i => Math.min(TOP_LEVEL_VIEWS.length - 1, i + 1))
      const shortcutView = TOP_LEVEL_VIEWS.find(v => VIEW_CONFIG[v].key === input)
      if (shortcutView !== undefined || key.return) {
        setView(shortcutView ?? TOP_LEVEL_VIEWS[viewPickerSelected]!)
        setActiveProjectId(undefined)
        setSelected(0)
        setMode('list')
      }
      return
    }
    if (mode === 'picking-agenda-for-task') {
      if (key.escape) { setMode('list'); return }
      if (key.upArrow) setAgendaPickerSelected(i => Math.max(0, i - 1))
      if (key.downArrow) setAgendaPickerSelected(i => Math.min(agendas.length, i + 1))
      if (key.return) {
        const task = (view === 'project' ? projectTasks : tasks)[selected]
        if (task !== undefined) {
          const patch = agendaPickerSelected === 0
            ? { agendaId: CLEAR }
            : { agendaId: agendas[agendaPickerSelected - 1]!.id }
          appendAndRefresh(updateTask(state, { taskId: task.id, patch }))
        }
        setMode('list')
      }
      return
    }
    if (mode === 'picking-sphere-for-agenda') {
      if (key.escape) { setMode('settings'); return }
      if (key.upArrow) setPickerSelected(i => Math.max(0, i - 1))
      if (key.downArrow) setPickerSelected(i => Math.min(spheres.length - 1, i + 1))
      if (key.return && spheres.length > 0) {
        setAgendaSphereId(spheres[pickerSelected]!.id)
        setMode('creating-agenda')
      }
      return
    }
    if (mode === 'settings') {
      if (key.escape) { setMode('list'); return }
      if (key.upArrow) setSettingsSelected(i => Math.max(0, i - 1))
      if (key.downArrow) setSettingsSelected(i => Math.min(SETTINGS_OPTIONS.length - 1, i + 1))
      if (key.return) {
        if (SETTINGS_OPTIONS[settingsSelected] === 'Create Sphere') setMode('creating-sphere')
        if (SETTINGS_OPTIONS[settingsSelected] === 'Create Agenda') startCreateAgenda()
      }
      return
    }
    // list mode
    if (key.escape) {
      if (view === 'project') {
        setView('projects')
        setSelected(Math.max(0, projects.findIndex(p => p.id === activeProjectId)))
      } else exit()
    }
    if (input === 'v') {
      const idx = view === 'project' ? TOP_LEVEL_VIEWS.indexOf('projects') : TOP_LEVEL_VIEWS.indexOf(view as 'tasks' | 'projects')
      setViewPickerSelected(Math.max(0, idx))
      setMode('picking-view')
    }
    if (input === 'q' && !showCompleted) {
      if (view === 'projects' && !showArchived) setMode('adding-project')
      else if (view !== 'projects') setMode('adding')
    }
    if (input === 'e') {
      if (view === 'projects') {
        const project = projects[selected]
        if (project !== undefined) { setFormValue(project.name); setMode('editing-project') }
      } else {
        const task = (view === 'project' ? projectTasks : tasks)[selected]
        if (task !== undefined) { setFormValue(task.title); setMode('editing-task') }
      }
    }
    if (input === 'x' && view === 'projects') {
      const project = projects[selected]
      if (project !== undefined) {
        store.appendEvents(project.isArchived ? unarchiveProject(state, project.id) : archiveProject(state, project.id))
        const newState = refreshState()
        const newProjects = activeSphere !== undefined
          ? listProjects(newState, { sphereId: activeSphere.id, isArchived: showArchived })
          : []
        setSelected(i => Math.max(0, Math.min(i, newProjects.length - 1)))
      }
    }
    if (input === 'X' && view === 'projects') {
      setShowArchived(v => !v)
      setSelected(0)
    }
    if (input === 'a' && VIEW_CONFIG[view].hasTasks) {
      const task = (view === 'project' ? projectTasks : tasks)[selected]
      if (task !== undefined) {
        const currentIdx = task.agendaId !== undefined ? agendas.findIndex(a => a.id === task.agendaId) + 1 : 0
        setAgendaPickerSelected(Math.max(0, currentIdx))
        setMode('picking-agenda-for-task')
      }
    }
    if (input === 'C' && VIEW_CONFIG[view].hasTasks) {
      setShowCompleted(v => !v)
      setSelected(0)
    }
    if (input === 'c' && VIEW_CONFIG[view].hasTasks && !showCompleted) {
      const task = (view === 'project' ? projectTasks : tasks)[selected]
      if (task !== undefined) {
        store.appendEvents(completeTask(state, task.id))
        const newState = refreshState()
        const newTasks = view === 'project' && activeProjectId !== undefined
          ? listTasks(newState, { projectId: activeProjectId, status: 'open' })
          : activeSphere !== undefined
            ? listTasks(newState, { sphereId: activeSphere.id, status: 'open' })
            : []
        setSelected(i => Math.max(0, Math.min(i, newTasks.length - 1)))
      }
    }
    if (input === 'n' && view === 'project' && !showCompleted) {
      const task = projectTasks[selected]
      if (task !== undefined) {
        appendAndRefresh(updateTask(state, { taskId: task.id, patch: { isNext: task.isNext !== true } }))
      }
    }
    if (key.return && view === 'projects') {
      const project = projects[selected]
      if (project !== undefined) {
        setActiveProjectId(project.id)
        setView('project')
        setSelected(0)
      }
    }
    if (input === 'k') setMode('settings')
    if (input === ']') {
      const idx = spheres.findIndex(s => s.id === activeSphere?.id)
      setCurrentSphereId(spheres[(idx + 1) % spheres.length]?.id)
      if (view === 'project') { setView('projects'); setSelected(0) }
    }
    if (key.upArrow) setSelected(i => Math.max(0, i - 1))
    if (key.downArrow) setSelected(i => Math.min(listLength - 1, i + 1))
  })

  function handleTaskSubmit(title: string) {
    const trimmed = title.trim()
    if (trimmed) {
      if (view === 'project' && activeProjectId !== undefined) {
        store.appendEvents(createTask(state, { title: trimmed, projectId: activeProjectId }))
        const newState = refreshState()
        setSelected(listTasks(newState, { projectId: activeProjectId, status: 'open' }).length - 1)
      } else if (activeSphere !== undefined) {
        store.appendEvents(createTask(state, { title: trimmed, sphereId: activeSphere.id }))
        const newState = refreshState()
        setSelected(listTasks(newState, { sphereId: activeSphere.id, status: 'open' }).length - 1)
      }
    }
    setFormValue('')
    setMode('list')
  }

  function handleEditSubmit(title: string) {
    const trimmed = title.trim()
    const task = (view === 'project' ? projectTasks : tasks)[selected]
    if (trimmed && task !== undefined) {
      appendAndRefresh(updateTask(state, { taskId: task.id, patch: { title: trimmed } }))
    }
    setFormValue('')
    setMode('list')
  }

  function handleProjectSubmit(name: string) {
    const trimmed = name.trim()
    if (trimmed && activeSphere !== undefined) {
      appendAndRefresh(createProject(state, { name: trimmed, sphereId: activeSphere.id }))
    }
    setFormValue('')
    setMode('list')
  }

  function handleEditProjectSubmit(name: string) {
    const trimmed = name.trim()
    const project = projects[selected]
    if (trimmed && project !== undefined) {
      appendAndRefresh(updateProject(state, project.id, { name: trimmed }))
    }
    setFormValue('')
    setMode('list')
  }

  function handleSphereSubmit(name: string) {
    const trimmed = name.trim()
    if (trimmed) {
      const events = createSphere(state, { name: trimmed })
      store.appendEvents(events)
      const newState = refreshState()
      if (currentSphereId === undefined) {
        setCurrentSphereId(listSpheres(newState)[0]?.id)
      }
    }
    setFormValue('')
    setMode('settings')
  }

  function handleAgendaSubmit(title: string) {
    const trimmed = title.trim()
    if (trimmed && agendaSphereId !== undefined) {
      appendAndRefresh(createAgenda(state, { title: trimmed, sphereId: agendaSphereId }))
    }
    setFormValue('')
    setAgendaSphereId(undefined)
    setMode('settings')
  }

  let title: React.ReactNode
  let content: React.ReactNode
  let footer: React.ReactNode

  if (mode === 'picking-agenda-for-task') {
    const task = (view === 'project' ? projectTasks : tasks)[selected]
    const options = ['No agenda', ...agendas.map(a => a.title)]
    title = <Text bold color="cyan">Agenda{task !== undefined ? ` — ${task.title}` : ''}</Text>
    content = options.map((label, i) => (
      <Text key={label} {...(i === agendaPickerSelected ? { color: 'blue' as const } : {})}>
        {i === agendaPickerSelected ? '> ' : '  '}{i > 0 ? '@' : ''}{label}
      </Text>
    ))
    footer = <Text dimColor>↑↓ navigate  enter select  esc back</Text>
  } else if (mode === 'picking-view') {
    title = <Text bold color="cyan">View</Text>
    content = TOP_LEVEL_VIEWS.map((v, i) => (
      <Text key={v} {...(i === viewPickerSelected ? { color: 'blue' as const } : {})}>
        {i === viewPickerSelected ? '> ' : '  '}{VIEW_CONFIG[v].label}<Text dimColor>  {VIEW_CONFIG[v].key}</Text>
      </Text>
    ))
    footer = <Text dimColor>↑↓ navigate  enter select  esc back</Text>
  } else if (mode === 'settings' || mode === 'creating-sphere' || mode === 'picking-sphere-for-agenda' || mode === 'creating-agenda') {
    title = <Text bold color="cyan">Settings</Text>
    content = (
      <>
        {SETTINGS_OPTIONS.map((option, i) => (
          <Text key={option} {...(i === settingsSelected ? { color: 'blue' as const } : {})}>
            {i === settingsSelected ? '> ' : '  '}{option}
          </Text>
        ))}
        <Box marginTop={1} flexDirection="column">
          {mode === 'creating-sphere' ? (
            <Box>
              <Text>Sphere name: </Text>
              <TextInput value={formValue} onChange={setFormValue} onSubmit={handleSphereSubmit} />
            </Box>
          ) : mode === 'picking-sphere-for-agenda' ? (
            spheres.length === 0 ? (
              <Text color="red">No spheres found — create a sphere first.</Text>
            ) : (
              <>
                <Text dimColor>Select a sphere:</Text>
                {spheres.map((sphere, i) => (
                  <Text key={sphere.id} {...(i === pickerSelected ? { color: 'blue' as const } : {})}>
                    {i === pickerSelected ? '> ' : '  '}{sphere.name}
                  </Text>
                ))}
              </>
            )
          ) : mode === 'creating-agenda' ? (
            <Box>
              <Text>Agenda title: </Text>
              <TextInput value={formValue} onChange={setFormValue} onSubmit={handleAgendaSubmit} />
            </Box>
          ) : null}
        </Box>
      </>
    )
    footer = <Text dimColor>↑↓ navigate  enter select  esc back</Text>
  } else {
    const completedTag = showCompleted && VIEW_CONFIG[view].hasTasks ? <Text color="yellow"> completed</Text> : null
    const archivedTag = showArchived && view === 'projects' ? <Text color="yellow"> archived</Text> : null
    title = view === 'project'
      ? <><Text bold color="cyan">{activeSphere?.name ?? 'Palimpsest'}</Text><Text dimColor> — {activeProject?.name ?? ''}</Text>{completedTag}</>
      : <><Text bold color="cyan">{activeSphere?.name ?? 'Palimpsest'}</Text><Text dimColor> — {VIEW_CONFIG[view].label}</Text>{archivedTag}{completedTag}</>
    content = activeSphere === undefined ? (
      <Text dimColor>No spheres yet — press s to open settings and create one.</Text>
    ) : view === 'tasks' ? (
      <TaskList tasks={tasks} selected={selected} state={state} showProject emptyMessage={showCompleted ? 'No completed tasks in this sphere.' : 'No open tasks in this sphere.'} />
    ) : view === 'projects' ? (
      projects.length === 0 ? (
        <Text dimColor>No projects.</Text>
      ) : projects.map((project, i) => {
        const isSelected = i === selected
        const hasNext = projectStats.hasNext.has(project.id)
        const color = isSelected ? 'blue' as const : !showArchived && !hasNext ? 'red' as const : undefined
        const count = projectStats.taskCount.get(project.id) ?? 0
        return (
          <Row key={project.id} isSelected={isSelected} color={color} title={project.name}>
            {project.archivedAt !== undefined ? <Meta>{formatDate(project.archivedAt)}</Meta> : null}
            <Meta>{count}</Meta>
          </Row>
        )
      })
    ) : (
      <TaskList tasks={projectTasks} selected={selected} state={state} emptyMessage={showCompleted ? 'No completed tasks in this project.' : 'No open tasks in this project.'} />
    )
    footer = mode === 'adding' ? (
      activeSphere === undefined ? (
        <Text color="red">No spheres found — create a sphere first.</Text>
      ) : (
        <Box>
          <Text>New task: </Text>
          <TextInput value={formValue} onChange={setFormValue} onSubmit={handleTaskSubmit} />
        </Box>
      )
    ) : mode === 'editing-task' ? (
      <Box>
        <Text>Edit task: </Text>
        <TextInput value={formValue} onChange={setFormValue} onSubmit={handleEditSubmit} />
      </Box>
    ) : mode === 'adding-project' ? (
      activeSphere === undefined ? (
        <Text color="red">No spheres found — create a sphere first.</Text>
      ) : (
        <Box>
          <Text>New project: </Text>
          <TextInput value={formValue} onChange={setFormValue} onSubmit={handleProjectSubmit} />
        </Box>
      )
    ) : mode === 'editing-project' ? (
      <Box>
        <Text>Edit project: </Text>
        <TextInput value={formValue} onChange={setFormValue} onSubmit={handleEditProjectSubmit} />
      </Box>
    ) : view === 'project' ? (
      <Text dimColor>↑↓ navigate  {showCompleted ? '' : 'q new  e edit  c complete  n next  a agenda  '}C {showCompleted ? 'open' : 'completed'}  esc back</Text>
    ) : view === 'projects' ? (
      <Text dimColor>↑↓ navigate  v view  {showArchived ? 'x unarchive  X active' : 'q new  e edit  x archive  X archived'}  ] sphere  k settings</Text>
    ) : (
      <Text dimColor>↑↓ navigate  v view  {showCompleted ? '' : 'q new  e edit  c complete  a agenda  '}C {showCompleted ? 'open' : 'completed'}  ] sphere  k settings</Text>
    )
  }

  return (
    <Box flexDirection="column" height={termRows} paddingX={1}>
      <Box paddingTop={1}>{title}</Box>
      <Box flexGrow={1} flexDirection="column" paddingTop={1} overflow="hidden">
        {content}
      </Box>
      <Box paddingBottom={1}>{footer}</Box>
    </Box>
  )
}

render(<App />, { alternateScreen: true })
