'use client'
import { useEffect, useReducer, useRef, useState } from 'react'
import { initialState, reducer } from '../../lib/editor/state'
import { canonicalPlacement, contentSchema, MAX_IMAGE_BYTES } from '../../lib/editor/schema'
import {
  BLANK_MASK_FILENAME,
  BLANK_POSTER_FILENAME,
  BLANK_POSTER_HEIGHT,
  BLANK_POSTER_WIDTH,
  buildBlankMaskRgba,
  buildBlankPosterRgba,
} from '../../lib/editor/blank'
import { TEXT_MASK_FONTS, deriveMaskLetter, searchControlState } from '../../lib/editor/text-mask'
import type { Placement } from '../../lib/editor/schema'
import EditorHeader from './EditorHeader'
import StepRail from './StepRail'
import PreviewPanel from './PreviewPanel'
import PreparationError from './PreparationError'
import StepInput from './steps/StepInput'
import StepMaskSearch from './steps/StepMaskSearch'
import StepAdjust from './steps/StepAdjust'
import StepGenerate from './steps/StepGenerate'
import { useBlobUrls } from './hooks/use-blob-urls'
import { useEditorRequest } from './hooks/use-editor-request'
import { useIconSearch } from './hooks/use-icon-search'
import { useMaskSelection } from './hooks/use-mask-selection'
const freshSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!
const steps = ['Input text', 'Mask Search', 'Adjust QR', 'Generate']
export default function Editor() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [step, setStep] = useState(1)
  const [textConfirmed, setTextConfirmed] = useState(false)
  const [poster, setPoster] = useState<File | null>(null),
    [mask, setMask] = useState<File | null>(null),
    [posterUrl, setPosterUrl] = useState('')
  const searchQueryRef = useRef('')
  const iconSearch = useIconSearch(searchQueryRef)
  const { request, cancel } = useEditorRequest({ state, dispatch, poster, mask })
  const contentCheck = contentSchema.safeParse(state.content)
  const contentError = !contentCheck.success
    ? contentCheck.error.issues[0]!.message
    : state.field === 'content'
      ? state.error
      : null
  const suggestedMask = deriveMaskLetter(state.content)
  const maskSelection = useMaskSelection({
    revision: state.revision,
    prepared: state.prepared,
    iconResults: iconSearch.results,
    suggestedMask,
    closeGallery: iconSearch.closeGallery,
    onUploadMask: uploadMaskFile,
    dispatch,
  })
  const searchQuery = maskSelection.text.trim()
  searchQueryRef.current = searchQuery
  const searchState = searchControlState(searchQuery, iconSearch.fetchedQuery, iconSearch.results.length)
  const preparationError = state.error && state.field !== 'content' ? state.error : null
  useEffect(() => {
    if (step !== 2 || typeof document === 'undefined' || !('fonts' in document)) return
    for (const entry of TEXT_MASK_FONTS) {
      if (!entry.family) continue
      void document.fonts.load(`34px "${entry.family}"`).catch(() => {})
    }
  }, [step])
  // Typing never searches; it only closes the gallery so no stale results are shown.
  useEffect(() => {
    iconSearch.closeGallery()
  }, [maskSelection.text]) // eslint-disable-line react-hooks/exhaustive-deps
  // Entering step 2 re-derives the control from the input and starts on the mask preview.
  useEffect(() => {
    iconSearch.closeGallery()
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps
  const previews = useBlobUrls(
    state.prepared
      ? { 'mask.png': state.prepared.overlay, 'region.png': state.prepared.mask, 'qr.png': state.prepared.qr }
      : {},
  )
  const artifacts = useBlobUrls(state.result?.artifacts ?? {})
  useEffect(() => {
    if (!poster) return
    const url = URL.createObjectURL(poster)
    setPosterUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [poster])
  function edit(patch: Parameters<typeof reducer>[1] & { type: 'edit' }) {
    cancel()
    if (patch.patch.content !== undefined) setTextConfirmed(false)
    dispatch(patch)
  }
  function uploadMaskFile(file: File) {
    setMask(file)
    edit({ type: 'edit', patch: {}, reset: true })
    if (file.size > MAX_IMAGE_BYTES)
      dispatch({
        type: 'error',
        revision: state.revision + 1,
        message: 'Each PNG must be 10 MiB or smaller.',
        field: 'mask',
      })
  }
  function ensureBlankPoster() {
    if (poster) return
    const width = BLANK_POSTER_WIDTH,
      height = BLANK_POSTER_HEIGHT
    const posterCanvas = document.createElement('canvas')
    posterCanvas.width = width
    posterCanvas.height = height
    posterCanvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(buildBlankPosterRgba(width, height)), width, height), 0, 0)
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = width
    maskCanvas.height = height
    maskCanvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(buildBlankMaskRgba(width, height)), width, height), 0, 0)
    posterCanvas.toBlob((posterBlob) => {
      maskCanvas.toBlob((maskBlob) => {
        if (!posterBlob || !maskBlob) return
        cancel()
        setPoster(new File([posterBlob], BLANK_POSTER_FILENAME, { type: 'image/png' }))
        setMask(new File([maskBlob], BLANK_MASK_FILENAME, { type: 'image/png' }))
        dispatch({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } }, reset: true })
      }, 'image/png')
    }, 'image/png')
  }
  useEffect(() => {
    if (step === 2) ensureBlankPoster()
  }, [step]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (textConfirmed && !poster) ensureBlankPoster()
  }, [textConfirmed]) // eslint-disable-line react-hooks/exhaustive-deps
  const ready =
    !!state.prepared &&
    state.prepared.revision === state.revision &&
    !state.error &&
    !state.busy &&
    contentCheck.success
  const move = (box: Placement) =>
    edit({ type: 'edit', patch: { placement: canonicalPlacement(box, state.prepared!.qrMetadata.totalModules) } })
  const canEnter = (index: number) => {
    if (index <= 1) return true
    if (index >= 2 && (!textConfirmed || !contentCheck.success)) return false
    if (index === 2) return true
    if (index === 3) return !!poster
    if (index === 4) return !!state.prepared && !!state.placement
    return !!state.prepared
  }
  function goto(index: number) {
    if (index >= 1 && index <= 4 && canEnter(index)) setStep(index)
  }
  function continueFromText() {
    if (!contentCheck.success) return
    if (suggestedMask && (maskSelection.text.trim()[0] ?? '') !== suggestedMask) maskSelection.setText(suggestedMask)
    setTextConfirmed(true)
    ensureBlankPoster()
    setStep(2)
  }
  function handleSearch() {
    void iconSearch.handleSearchClick(searchQuery, maskSelection.busy)
  }
  function handleGallerySelect(index: number) {
    const item = iconSearch.results[index]
    if (!item) return
    maskSelection.selectIcon(item)
  }
  useEffect(() => {
    if (state.showingResult) setStep(4)
  }, [state.showingResult])
  return (
    <main>
      <EditorHeader />
      <StepRail steps={steps} step={step} canEnter={canEnter} onGoto={goto} />
      {step === 1 ? (
        <StepInput
          content={state.content}
          contentError={contentError}
          canContinue={contentCheck.success}
          suggestedMask={suggestedMask}
          preparationError={preparationError}
          onContentChange={(value) => edit({ type: 'edit', patch: { content: value } })}
          onContinue={continueFromText}
          onRetry={() => void request('prepare')}
        />
      ) : (
        <div className={step === 2 ? 'workspace workspace-step2' : 'workspace'}>
          <aside>
            <div className="panel-heading">
              <span className="eyebrow">POSTER STUDIO · STEP {step} OF 4</span>
              <h1>
                Make the code
                <br />
                part of the art.
              </h1>
            </div>
            {step === 2 && (
              <StepMaskSearch
                mask={maskSelection}
                search={iconSearch}
                suggestedMask={suggestedMask}
                searchState={searchState}
                prepared={!!state.prepared}
                onSearch={handleSearch}
                onGoto={goto}
              />
            )}
            {step === 3 && (
              <StepAdjust
                state={state}
                ready={ready}
                canReset={!!poster && contentCheck.success}
                onMove={move}
                onSettings={(patch) => edit({ type: 'edit', patch: { settings: { ...state.settings, ...patch } } })}
                onNewSeed={() => edit({ type: 'edit', patch: { settings: { ...state.settings, seed: freshSeed() } } })}
                onResetPlacement={() => edit({ type: 'edit', patch: { placement: null } })}
                onAssemble={() => {
                  void request('assemble')
                  setStep(4)
                }}
                onGoto={goto}
              />
            )}
            {step === 4 && (
              <StepGenerate
                state={state}
                ready={ready}
                preparationError={preparationError}
                onAssemble={() => void request('assemble')}
                onRetry={() => void request('prepare')}
                onBack={() => {
                  dispatch({ type: 'view', result: false })
                  goto(3)
                }}
              />
            )}
            {preparationError && step !== 4 && (
              <PreparationError message={preparationError} onRetry={() => void request('prepare')} />
            )}
          </aside>
          <PreviewPanel
            step={step}
            showingResult={state.showingResult}
            dimensions={state.prepared ? { width: state.prepared.width, height: state.prepared.height } : null}
            result={state.result}
            artifacts={artifacts}
            previews={previews}
            posterUrl={posterUrl}
            placement={state.placement}
            modules={state.prepared?.qrMetadata.totalModules ?? 0}
            invalid={!!state.error}
            maskPreview={{
              effectiveMask: maskSelection.effectiveMask,
              family: maskSelection.font.family,
              isBlank: maskSelection.isBlank,
              isIconMode: maskSelection.isIconMode,
              iconResults: iconSearch.results,
              selectedIconId: maskSelection.selectedIconId,
            }}
            gallery={{
              query: searchQuery,
              total: iconSearch.total,
              items: iconSearch.results,
              selectedIconId: maskSelection.selectedIconId,
              onSelect: handleGallerySelect,
              onClose: iconSearch.closeGallery,
            }}
            galleryMode={iconSearch.galleryMode}
            onMove={move}
            onReturnToEditing={() => dispatch({ type: 'view', result: false })}
          />
        </div>
      )}
    </main>
  )
}
