import React, { useState, useMemo } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import {
  PalimpsestStore,
  listTasks, listSpheres, getProject,
  createTask, createSphere, createAgenda,
} from 'palimpsest'
import type { ProjectionState, SphereId } from 'palimpsest'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'

const filePath = process.env['PALIMPSEST_FILE'] ?? join(homedir(), '.palimpsest', 'events.jsonl')
mkdirSync(dirname(filePath), { recursive: true })
const store = new PalimpsestStore(filePath)

type Mode = 'list' | 'adding' | 'settings' | 'creating-sphere' | 'picking-sphere-for-agenda' | 'creating-agenda'

const SETTINGS_OPTIONS = ['Create Sphere', 'Create Agenda'] as const

function App() {
  const [state, setState] = useState<ProjectionState>(() => store.getState())
  const tasks = useMemo(() => listTasks(state), [state])
  const spheres = useMemo(() => listSpheres(state), [state])
  const [selected, setSelected] = useState(0)
  const [settingsSelected, setSettingsSelected] = useState(0)
  const [pickerSelected, setPickerSelected] = useState(0)
  const [selectedSphereId, setSelectedSphereId] = useState<SphereId | undefined>(undefined)
  const [mode, setMode] = useState<Mode>('list')
  const [formValue, setFormValue] = useState('')
  const { exit } = useApp()

  function appendAndRefresh(events: ReturnType<typeof createTask>) {
    store.appendEvents(events)
    setState(store.getState())
  }

  function startCreateAgenda() {
    if (spheres.length === 0) {
      setMode('picking-sphere-for-agenda') // will show error
    } else if (spheres.length === 1) {
      setSelectedSphereId(spheres[0]!.id)
      setMode('creating-agenda')
    } else {
      setPickerSelected(0)
      setMode('picking-sphere-for-agenda')
    }
  }

  useInput((input, key) => {
    if (mode === 'adding' || mode === 'creating-sphere' || mode === 'creating-agenda') {
      if (key.escape) {
        setFormValue('')
        setMode(mode === 'adding' ? 'list' : 'settings')
      }
      return
    }
    if (mode === 'picking-sphere-for-agenda') {
      if (key.escape) { setMode('settings'); return }
      if (key.upArrow) setPickerSelected(i => Math.max(0, i - 1))
      if (key.downArrow) setPickerSelected(i => Math.min(spheres.length - 1, i + 1))
      if (key.return && spheres.length > 0) {
        setSelectedSphereId(spheres[pickerSelected]!.id)
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
    if (input === 'q' || key.escape) exit()
    if (input === 'n') setMode('adding')
    if (input === 's') setMode('settings')
    if (key.upArrow) setSelected(i => Math.max(0, i - 1))
    if (key.downArrow) setSelected(i => Math.min(tasks.length - 1, i + 1))
  })

  function handleTaskSubmit(title: string) {
    const trimmed = title.trim()
    const sphere = spheres[0]
    if (trimmed && sphere !== undefined) {
      appendAndRefresh(createTask(state, { title: trimmed, sphereId: sphere.id }))
    }
    setFormValue('')
    setMode('list')
  }

  function handleSphereSubmit(name: string) {
    const trimmed = name.trim()
    if (trimmed) appendAndRefresh(createSphere(state, { name: trimmed }))
    setFormValue('')
    setMode('settings')
  }

  function handleAgendaSubmit(title: string) {
    const trimmed = title.trim()
    if (trimmed && selectedSphereId !== undefined) {
      appendAndRefresh(createAgenda(state, { title: trimmed, sphereId: selectedSphereId }))
    }
    setFormValue('')
    setSelectedSphereId(undefined)
    setMode('settings')
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

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text bold color="cyan">Palimpsest — All Tasks</Text>
      <Box marginTop={1} flexDirection="column">
        {tasks.length === 0 ? (
          <Text dimColor>No tasks found.</Text>
        ) : tasks.map((task, i) => {
          const project = task.projectId !== undefined ? getProject(state, task.projectId) : undefined
          const isSelected = i === selected
          const statusColor = task.status === 'open' ? 'green' : task.status === 'completed' ? 'gray' : 'red'

          return (
            <Box key={task.id}>
              <Text {...(isSelected ? { color: 'blue' as const } : {})}>
                {isSelected ? '▶ ' : '  '}
                <Text color={statusColor}>[{task.status[0]?.toUpperCase()}]</Text>
                {' '}{task.title}
                {project !== undefined ? <Text dimColor> · {project.name}</Text> : null}
                {task.dueDate !== undefined ? <Text dimColor> · due {task.dueDate}</Text> : null}
              </Text>
            </Box>
          )
        })}
      </Box>
      <Box marginTop={1}>
        {mode === 'adding' ? (
          spheres.length === 0 ? (
            <Text color="red">No spheres found — create a sphere first.</Text>
          ) : (
            <Box>
              <Text>New task: </Text>
              <TextInput value={formValue} onChange={setFormValue} onSubmit={handleTaskSubmit} />
            </Box>
          )
        ) : (
          <Text dimColor>↑↓ navigate  n new  s settings  q quit</Text>
        )}
      </Box>
    </Box>
  )
}

render(<App />)
