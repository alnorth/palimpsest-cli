import React, { useState, useMemo, useEffect } from 'react'
import { render, Box, Text, useInput, useWindowSize } from 'ink'
import { TaskList } from './TaskList.js'
import { Row, Meta } from './Row.js'
import TextInput from 'ink-text-input'
import {
  PalimpsestStore, CLEAR,
  listTasks, listProjects, listSpheres, listAgendas, getProject, getAgenda,
  createTask, updateTask, completeTask, uncompleteTask, createProject, updateProject, archiveProject, unarchiveProject, createSphere, createAgenda,
} from 'palimpsest'
import type { ProjectionState, SphereId, ProjectId, TaskId } from 'palimpsest'
import { formatDate, formatDateTime } from './format.js'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

const filePath = process.env['PALIMPSEST_FILE'] ?? join(homedir(), '.palimpsest', 'events.jsonl')
mkdirSync(dirname(filePath), { recursive: true })
const store = new PalimpsestStore(filePath)

type View = 'tasks' | 'projects' | 'project' | 'task'
type Mode = 'list' | 'picking-view' | 'adding' | 'editing-task' | 'editing-description' | 'picking-agenda-for-task' | 'adding-project' | 'editing-project' | 'settings' | 'creating-sphere' | 'picking-sphere-for-agenda' | 'creating-agenda'

const VIEW_CONFIG = {
  tasks:    { label: 'Tasks',    key: 't' },
  projects: { label: 'Projects', key: 'p' },
  project:  { label: 'Project'            },
  task:     { label: 'Task'               },
} satisfies Record<View, { label: string; key?: string }>

const TOP_LEVEL_VIEWS = (['tasks', 'projects'] as const).filter(v => VIEW_CONFIG[v].key !== undefined)
const SETTINGS_OPTIONS = ['Create Sphere', 'Create Agenda'] as const

interface NavState {
  view: View
  selected: number
  activeProjectId: ProjectId | undefined
  activeTaskId: TaskId | undefined
  showCompleted: boolean
  showArchived: boolean
}

const INITIAL_NAV: NavState = { view: 'tasks', selected: 0, activeProjectId: undefined, activeTaskId: undefined, showCompleted: false, showArchived: false }

interface Shortcut {
  key: string
  label: string
  row: 'state' | 'view'
  when?: boolean
  show?: boolean
  action: () => void
}

function App() {
  const [state, setState] = useState<ProjectionState>(() => store.getState())
  const spheres = useMemo(() => listSpheres(state), [state])
  const [currentSphereId, setCurrentSphereId] = useState<SphereId | undefined>(() => store.getState().spheres.values().next().value?.id)
  const activeSphere = useMemo(
    () => (currentSphereId !== undefined ? state.spheres.get(currentSphereId) : undefined) ?? spheres[0],
    [state, currentSphereId, spheres],
  )
  const [navStack, setNavStack] = useState<NavState[]>([INITIAL_NAV])
  const currentNav = navStack[navStack.length - 1] ?? INITIAL_NAV
  const { view, selected, activeProjectId, activeTaskId, showCompleted, showArchived } = currentNav

  const tasks = useMemo(() => {
    if (activeSphere === undefined) return []
    const result = listTasks(state, { sphereId: activeSphere.id, status: showCompleted ? 'completed' : 'open' })
    if (showCompleted) result.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    return result
  }, [state, activeSphere, showCompleted])
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
  const activeTask = useMemo(
    () => activeTaskId !== undefined ? state.tasks.get(activeTaskId) : undefined,
    [state, activeTaskId],
  )

  const [viewPickerSelected, setViewPickerSelected] = useState(0)
  const [agendaPickerSelected, setAgendaPickerSelected] = useState(0)
  const [settingsSelected, setSettingsSelected] = useState(0)
  const [pickerSelected, setPickerSelected] = useState(0)
  const [agendaSphereId, setAgendaSphereId] = useState<SphereId | undefined>(undefined)
  const [mode, setMode] = useState<Mode>('list')
  const [formValue, setFormValue] = useState('')
  const { rows: termRows } = useWindowSize()

  useEffect(() => {
    const suffix = view === 'task' ? `Task: ${activeTask?.title ?? ''}`
      : view === 'project' ? `Project: ${activeProject?.name ?? ''}`
      : VIEW_CONFIG[view].label
    process.stdout.write(`\x1b]0;Palimpsest — ${suffix}\x07`)
    return () => { process.stdout.write('\x1b]0;\x07') }
  }, [view, activeTask, activeProject])

  const listLength = view === 'tasks' ? tasks.length : view === 'projects' ? projects.length : view === 'project' ? projectTasks.length : 0
  const currentTask = view === 'task' ? activeTask : view === 'project' ? projectTasks[selected] : view === 'tasks' ? tasks[selected] : undefined

  function refreshState() {
    const newState = store.getState()
    setState(newState)
    return newState
  }

  function appendAndRefresh(events: ReturnType<typeof createTask>) {
    store.appendEvents(events)
    refreshState()
  }

  function updateCurrent(patch: Partial<NavState> | ((prev: NavState) => Partial<NavState>)) {
    setNavStack(s => {
      const last = s[s.length - 1] ?? INITIAL_NAV
      const update = typeof patch === 'function' ? patch(last) : patch
      return [...s.slice(0, -1), { ...last, ...update }]
    })
  }

  function navigate(nextState: NavState) {
    setNavStack(s => [...s, nextState])
  }

  function goBack() {
    setNavStack(s => s.length > 1 ? s.slice(0, -1) : s)
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

  const shortcuts: Shortcut[] = [
    {
      key: 'v', label: 'view', row: 'view',
      show: view !== 'project' && view !== 'task',
      action: () => {
        const idx = view === 'project' ? TOP_LEVEL_VIEWS.indexOf('projects') : TOP_LEVEL_VIEWS.indexOf(view as 'tasks' | 'projects')
        setViewPickerSelected(Math.max(0, idx))
        setMode('picking-view')
      },
    },
    {
      key: 'q', label: 'new', row: 'state',
      when: view === 'tasks' || view === 'project',
      action: () => setMode('adding'),
    },
    {
      key: 'q', label: 'new', row: 'state',
      when: view === 'projects' && !showArchived,
      action: () => setMode('adding-project'),
    },
    {
      key: 'e', label: 'edit', row: 'state',
      when: currentTask?.status === 'open',
      action: () => { setFormValue(currentTask!.title); setMode('editing-task') },
    },
    {
      key: 'd', label: 'description', row: 'state',
      when: currentTask?.status === 'open',
      action: () => { setFormValue(currentTask!.description); setMode('editing-description') },
    },
    {
      key: 'e', label: 'edit', row: 'state',
      when: view === 'projects' && !showArchived,
      action: () => {
        const project = projects[selected]
        if (project !== undefined) { setFormValue(project.name); setMode('editing-project') }
      },
    },
    {
      key: 'c', label: currentTask?.status === 'completed' ? 'reopen' : 'complete', row: 'state',
      when: currentTask !== undefined,
      action: () => {
        store.appendEvents(showCompleted ? uncompleteTask(state, currentTask!.id) : completeTask(state, currentTask!.id))
        const newState = refreshState()
        const status = showCompleted ? 'completed' : 'open'
        if (view !== 'task') {
          const newTasks = view === 'project' && activeProjectId !== undefined
            ? listTasks(newState, { projectId: activeProjectId, status })
            : activeSphere !== undefined
              ? listTasks(newState, { sphereId: activeSphere.id, status })
              : []
          updateCurrent(prev => ({ selected: Math.max(0, Math.min(prev.selected, newTasks.length - 1)) }))
        }
      },
    },
    {
      key: 'n', label: 'next', row: 'state',
      when: (view === 'project' || view === 'task') && currentTask?.status === 'open',
      action: () => {
        appendAndRefresh(updateTask(state, { taskId: currentTask!.id, patch: { isNext: currentTask!.isNext !== true } }))
      },
    },
    {
      key: 's', label: 'star', row: 'state',
      when: currentTask?.status === 'open',
      action: () => {
        appendAndRefresh(updateTask(state, { taskId: currentTask!.id, patch: { isStarred: currentTask!.isStarred !== true } }))
      },
    },
    {
      key: 'a', label: 'agenda', row: 'state',
      when: currentTask?.status === 'open',
      action: () => {
        const idx = currentTask!.agendaId !== undefined ? agendas.findIndex(a => a.id === currentTask!.agendaId) + 1 : 0
        setAgendaPickerSelected(Math.max(0, idx))
        setMode('picking-agenda-for-task')
      },
    },
    {
      key: 'x', label: showArchived ? 'unarchive' : 'archive', row: 'state',
      when: view === 'projects',
      action: () => {
        const project = projects[selected]
        if (project !== undefined) {
          store.appendEvents(project.isArchived ? unarchiveProject(state, project.id) : archiveProject(state, project.id))
          const newState = refreshState()
          const newProjects = activeSphere !== undefined
            ? listProjects(newState, { sphereId: activeSphere.id, isArchived: showArchived })
            : []
          updateCurrent(prev => ({ selected: Math.max(0, Math.min(prev.selected, newProjects.length - 1)) }))
        }
      },
    },
    {
      key: 'P', label: 'view project', row: 'view',
      when: currentTask?.projectId !== undefined,
      action: () => {
        navigate({ ...currentNav, view: 'project', selected: 0, activeProjectId: currentTask!.projectId!, activeTaskId: undefined })
      },
    },
    {
      key: 'C', label: showCompleted ? 'open' : 'completed', row: 'view',
      when: view === 'tasks' || view === 'project',
      action: () => { navigate({ ...currentNav, showCompleted: !showCompleted, selected: 0 }) },
    },
    {
      key: 'X', label: showArchived ? 'active' : 'archived', row: 'view',
      when: view === 'projects',
      action: () => { navigate({ ...currentNav, showArchived: !showArchived, selected: 0 }) },
    },
    {
      key: ']', label: 'sphere', row: 'view',
      show: view !== 'project' && view !== 'task',
      action: () => {
        const idx = spheres.findIndex(s => s.id === activeSphere?.id)
        setCurrentSphereId(spheres[(idx + 1) % spheres.length]?.id)
        setNavStack([INITIAL_NAV])
      },
    },
    {
      key: 'k', label: 'settings', row: 'view',
      show: view !== 'project' && view !== 'task',
      action: () => setMode('settings'),
    },
  ]

  useInput((input, key) => {
    if (mode === 'adding' || mode === 'editing-task' || mode === 'editing-description' || mode === 'adding-project' || mode === 'editing-project' || mode === 'creating-sphere' || mode === 'creating-agenda') {
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
        const newView = shortcutView ?? TOP_LEVEL_VIEWS[viewPickerSelected]!
        setNavStack([{ ...INITIAL_NAV, view: newView }])
        setMode('list')
      }
      return
    }
    if (mode === 'picking-agenda-for-task') {
      if (key.escape) { setMode('list'); return }
      if (key.upArrow) setAgendaPickerSelected(i => Math.max(0, i - 1))
      if (key.downArrow) setAgendaPickerSelected(i => Math.min(agendas.length, i + 1))
      if (key.return) {
        const task = currentTask
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
    if (key.escape) goBack()
    if (key.return && view === 'projects') {
      const project = projects[selected]
      if (project !== undefined) {
        navigate({ ...currentNav, view: 'project', selected: 0, activeProjectId: project.id, activeTaskId: undefined })
      }
    }
    if (key.return && (view === 'tasks' || view === 'project')) {
      const task = (view === 'project' ? projectTasks : tasks)[selected]
      if (task !== undefined) {
        navigate({ ...currentNav, view: 'task', selected: 0, activeTaskId: task.id })
      }
    }
    if (key.upArrow) updateCurrent(prev => ({ selected: Math.max(0, prev.selected - 1) }))
    if (key.downArrow) updateCurrent(prev => ({ selected: Math.min(listLength - 1, prev.selected + 1) }))
    shortcuts.find(s => s.key === input && (s.when ?? true))?.action()
  })

  function handleTaskSubmit(title: string) {
    const trimmed = title.trim()
    if (trimmed) {
      if (view === 'project' && activeProjectId !== undefined) {
        store.appendEvents(createTask(state, { title: trimmed, projectId: activeProjectId }))
        const newState = refreshState()
        updateCurrent({ selected: listTasks(newState, { projectId: activeProjectId, status: 'open' }).length - 1 })
      } else if (activeSphere !== undefined) {
        store.appendEvents(createTask(state, { title: trimmed, sphereId: activeSphere.id }))
        const newState = refreshState()
        updateCurrent({ selected: listTasks(newState, { sphereId: activeSphere.id, status: 'open' }).length - 1 })
      }
    }
    setFormValue('')
    setMode('list')
  }

  function handleEditSubmit(title: string) {
    const trimmed = title.trim()
    const task = currentTask
    if (trimmed && task !== undefined) {
      appendAndRefresh(updateTask(state, { taskId: task.id, patch: { title: trimmed } }))
    }
    setFormValue('')
    setMode('list')
  }

  function handleEditDescriptionSubmit(description: string) {
    const task = currentTask
    if (task !== undefined) {
      appendAndRefresh(updateTask(state, { taskId: task.id, patch: { description: description.trim() } }))
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
    const task = currentTask
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
    const completedTag = showCompleted && view !== 'projects' ? <Text color="yellow"> completed</Text> : null
    const archivedTag = showArchived && view === 'projects' ? <Text color="yellow"> archived</Text> : null
    const visible = (s: Shortcut) => s.show ?? s.when ?? true
    const stateRow = shortcuts.filter(s => s.row === 'state' && visible(s)).map(s => `${s.key} ${s.label}`)
    const viewRow = ['↑↓ navigate', ...shortcuts.filter(s => s.row === 'view' && visible(s)).map(s => `${s.key} ${s.label}`)]
    if (navStack.length > 1) viewRow.push('esc back')
    const listHint = (
      <Box flexDirection="column">
        {stateRow.length > 0 && <Text dimColor>{stateRow.join('  ')}</Text>}
        <Text dimColor>{viewRow.join('  ')}</Text>
      </Box>
    )
    title = view === 'task'
      ? <><Text bold color="cyan">{activeSphere?.name ?? 'Palimpsest'}</Text><Text dimColor> — Task: {activeTask?.title ?? ''}</Text>{completedTag}</>
      : view === 'project'
      ? <><Text bold color="cyan">{activeSphere?.name ?? 'Palimpsest'}</Text><Text dimColor> — Project: {activeProject?.name ?? ''}</Text>{completedTag}</>
      : <><Text bold color="cyan">{activeSphere?.name ?? 'Palimpsest'}</Text><Text dimColor> — {VIEW_CONFIG[view].label}</Text>{archivedTag}{completedTag}</>
    content = activeSphere === undefined ? (
      <Text dimColor>No spheres yet — press s to open settings and create one.</Text>
    ) : view === 'task' ? (() => {
      const detailProject = activeTask?.projectId !== undefined ? getProject(state, activeTask.projectId) : undefined
      const detailAgenda = activeTask?.agendaId !== undefined ? getAgenda(state, activeTask.agendaId) : undefined
      return (
        <Box flexDirection="column">
          {activeTask?.description
            ? <Text>{activeTask.description}</Text>
            : <Text dimColor>No description.</Text>
          }
          <Box flexDirection="column" marginTop={1}>
            {detailProject !== undefined ? <Text dimColor>project    {detailProject.name}</Text> : null}
            {detailAgenda !== undefined ? <Text dimColor>agenda     @{detailAgenda.title}</Text> : null}
            {activeTask?.dueDate !== undefined ? <Text dimColor>due        {activeTask.dueDate}</Text> : null}
            {activeTask?.completedAt !== undefined ? <Text dimColor>completed  {formatDateTime(activeTask.completedAt)}</Text> : null}
            {activeTask?.isNext === true ? <Text dimColor>next action</Text> : null}
            {activeTask?.isStarred === true ? <Text dimColor>starred</Text> : null}
          </Box>
        </Box>
      )
    })() : view === 'tasks' ? (
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
    ) : mode === 'editing-description' ? (
      <Box>
        <Text>Description: </Text>
        <TextInput value={formValue} onChange={setFormValue} onSubmit={handleEditDescriptionSubmit} />
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
    ) : listHint
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
