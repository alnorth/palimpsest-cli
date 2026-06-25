import React, { useState, useMemo } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import {
  PalimpsestStore,
  listTasks, listProjects, listSpheres, getProject,
  createTask, updateTask, createProject, updateProject, createSphere, createAgenda,
} from 'palimpsest'
import type { ProjectionState, SphereId, ProjectId } from 'palimpsest'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

const filePath = process.env['PALIMPSEST_FILE'] ?? join(homedir(), '.palimpsest', 'events.jsonl')
mkdirSync(dirname(filePath), { recursive: true })
const store = new PalimpsestStore(filePath)

type View = 'tasks' | 'projects' | 'project'
type Mode = 'list' | 'picking-view' | 'adding' | 'editing-task' | 'adding-project' | 'editing-project' | 'settings' | 'creating-sphere' | 'picking-sphere-for-agenda' | 'creating-agenda'

const TOP_LEVEL_VIEWS: Extract<View, 'tasks' | 'projects'>[] = ['tasks', 'projects']
const VIEW_LABELS: Record<View, string> = { tasks: 'Tasks', projects: 'Projects', project: 'Project' }
const VIEW_KEYS: Record<Extract<View, 'tasks' | 'projects'>, string> = { tasks: 't', projects: 'p' }
const SETTINGS_OPTIONS = ['Create Sphere', 'Create Agenda'] as const

function App() {
  const [state, setState] = useState<ProjectionState>(() => store.getState())
  const spheres = useMemo(() => listSpheres(state), [state])
  const [currentSphereId, setCurrentSphereId] = useState<SphereId | undefined>(() => store.getState().spheres.values().next().value?.id)
  const activeSphere = useMemo(
    () => (currentSphereId !== undefined ? state.spheres.get(currentSphereId) : undefined) ?? spheres[0],
    [state, currentSphereId, spheres],
  )
  const tasks = useMemo(
    () => activeSphere !== undefined ? listTasks(state, { sphereId: activeSphere.id, status: 'open' }) : [],
    [state, activeSphere],
  )
  const projects = useMemo(
    () => activeSphere !== undefined ? listProjects(state, { sphereId: activeSphere.id }) : [],
    [state, activeSphere],
  )
  const [view, setView] = useState<View>('tasks')
  const [activeProjectId, setActiveProjectId] = useState<ProjectId | undefined>(undefined)
  const activeProject = useMemo(
    () => activeProjectId !== undefined ? state.projects.get(activeProjectId) : undefined,
    [state, activeProjectId],
  )
  const projectTasks = useMemo(
    () => activeProjectId !== undefined ? listTasks(state, { projectId: activeProjectId, status: 'open' }) : [],
    [state, activeProjectId],
  )
  const [selected, setSelected] = useState(0)
  const [viewPickerSelected, setViewPickerSelected] = useState(0)
  const [settingsSelected, setSettingsSelected] = useState(0)
  const [pickerSelected, setPickerSelected] = useState(0)
  const [agendaSphereId, setAgendaSphereId] = useState<SphereId | undefined>(undefined)
  const [mode, setMode] = useState<Mode>('list')
  const [formValue, setFormValue] = useState('')
  const { exit } = useApp()

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
      const shortcutView = TOP_LEVEL_VIEWS.find(v => VIEW_KEYS[v] === input)
      if (shortcutView !== undefined || key.return) {
        setView(shortcutView ?? TOP_LEVEL_VIEWS[viewPickerSelected]!)
        setActiveProjectId(undefined)
        setSelected(0)
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
      if (view === 'project') { setView('projects'); setSelected(0) }
      else exit()
    }
    if (input === 'v') {
      const idx = view === 'project' ? TOP_LEVEL_VIEWS.indexOf('projects') : TOP_LEVEL_VIEWS.indexOf(view as 'tasks' | 'projects')
      setViewPickerSelected(Math.max(0, idx))
      setMode('picking-view')
    }
    if (input === 'q') {
      if (view === 'projects') setMode('adding-project')
      else setMode('adding')
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
    if (key.return && view === 'projects') {
      const project = projects[selected]
      if (project !== undefined) {
        setActiveProjectId(project.id)
        setView('project')
        setSelected(0)
      }
    }
    if (input === 's') setMode('settings')
    if (input === ']') {
      const idx = spheres.findIndex(s => s.id === activeSphere?.id)
      setCurrentSphereId(spheres[(idx + 1) % spheres.length]?.id)
    }
    if (key.upArrow) setSelected(i => Math.max(0, i - 1))
    if (key.downArrow) setSelected(i => Math.min(listLength - 1, i + 1))
  })

  function handleTaskSubmit(title: string) {
    const trimmed = title.trim()
    if (trimmed) {
      if (view === 'project' && activeProjectId !== undefined) {
        appendAndRefresh(createTask(state, { title: trimmed, projectId: activeProjectId }))
      } else if (activeSphere !== undefined) {
        appendAndRefresh(createTask(state, { title: trimmed, sphereId: activeSphere.id }))
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

  if (mode === 'picking-view') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold color="cyan">View</Text>
        <Box marginTop={1} flexDirection="column">
          {TOP_LEVEL_VIEWS.map((v, i) => (
            <Text key={v} {...(i === viewPickerSelected ? { color: 'blue' as const } : {})}>
              {i === viewPickerSelected ? '▶ ' : '  '}{VIEW_LABELS[v]}<Text dimColor>  {VIEW_KEYS[v]}</Text>
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑↓ navigate  enter select  esc back</Text>
        </Box>
      </Box>
    )
  }

  if (mode === 'settings' || mode === 'creating-sphere' || mode === 'picking-sphere-for-agenda' || mode === 'creating-agenda') {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text bold color="cyan">Settings</Text>
        <Box marginTop={1} flexDirection="column">
          {SETTINGS_OPTIONS.map((option, i) => (
            <Text key={option} {...(i === settingsSelected ? { color: 'blue' as const } : {})}>
              {i === settingsSelected ? '▶ ' : '  '}{option}
            </Text>
          ))}
        </Box>
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
                    {i === pickerSelected ? '▶ ' : '  '}{sphere.name}
                  </Text>
                ))}
              </>
            )
          ) : mode === 'creating-agenda' ? (
            <Box>
              <Text>Agenda title: </Text>
              <TextInput value={formValue} onChange={setFormValue} onSubmit={handleAgendaSubmit} />
            </Box>
          ) : (
            <Text dimColor>↑↓ navigate  enter select  esc back</Text>
          )}
        </Box>
      </Box>
    )
  }

  const header = view === 'project'
    ? <><Text bold color="cyan">{activeSphere?.name ?? 'Palimpsest'}</Text><Text dimColor> — {activeProject?.name ?? ''}</Text></>
    : <><Text bold color="cyan">{activeSphere?.name ?? 'Palimpsest'}</Text><Text dimColor> — {VIEW_LABELS[view]}</Text></>

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box>{header}</Box>
      <Box marginTop={1} flexDirection="column">
        {activeSphere === undefined ? (
          <Text dimColor>No spheres yet — press s to open settings and create one.</Text>
        ) : view === 'tasks' ? (
          tasks.length === 0 ? (
            <Text dimColor>No open tasks.</Text>
          ) : tasks.map((task, i) => {
            const project = task.projectId !== undefined ? getProject(state, task.projectId) : undefined
            const isSelected = i === selected
            return (
              <Box key={task.id}>
                <Text {...(isSelected ? { color: 'blue' as const } : {})}>
                  {isSelected ? '▶ ' : '  '}
                  {task.title}
                  {project !== undefined ? <Text dimColor> · {project.name}</Text> : null}
                  {task.dueDate !== undefined ? <Text dimColor> · due {task.dueDate}</Text> : null}
                </Text>
              </Box>
            )
          })
        ) : view === 'projects' ? (
          projects.length === 0 ? (
            <Text dimColor>No projects.</Text>
          ) : projects.map((project, i) => {
            const isSelected = i === selected
            return (
              <Box key={project.id}>
                <Text {...(isSelected ? { color: 'blue' as const } : {})}>
                  {isSelected ? '▶ ' : '  '}
                  {project.name}
                </Text>
              </Box>
            )
          })
        ) : (
          projectTasks.length === 0 ? (
            <Text dimColor>No open tasks.</Text>
          ) : projectTasks.map((task, i) => {
            const isSelected = i === selected
            return (
              <Box key={task.id}>
                <Text {...(isSelected ? { color: 'blue' as const } : {})}>
                  {isSelected ? '▶ ' : '  '}
                  {task.title}
                  {task.dueDate !== undefined ? <Text dimColor> · due {task.dueDate}</Text> : null}
                </Text>
              </Box>
            )
          })
        )}
      </Box>
      <Box marginTop={1}>
        {mode === 'adding' ? (
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
          <Text dimColor>↑↓ navigate  q new  e edit  esc back</Text>
        ) : (
          <Text dimColor>↑↓ navigate  v view  q new  e edit  ] sphere  s settings</Text>
        )}
      </Box>
    </Box>
  )
}

render(<App />)
