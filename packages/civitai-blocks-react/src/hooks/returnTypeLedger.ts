/**
 * #380 — every hook exported from `@civitai/blocks-react` names its return type.
 *
 * ## The rule
 *
 * A hook on the package entry annotates its return with a type called
 * `Use<Hook>`, declared and exported from the hook's own module and re-exported
 * from `src/index.ts`. No exceptions: `useBlockResize` returns nothing and still
 * has `UseBlockResize = void`, `useBlockTheme` returns an app-sdk `Theme` and
 * still has `UseBlockTheme`. An exception list is a thing to remember and to get
 * wrong; an alias is free and keeps the guard's ledger exact.
 *
 * Before this, whether a hook's return type had a name was a coin flip: 17 of 37
 * hook files shipped one, 20 did not, and a consumer wrapping
 * `useBlockContext()` had to hand-copy a ten-field `Pick<BlockSnapshot, …>` that
 * lived only on the function's own return annotation.
 *
 * ## Why this file exists at all
 *
 * `tests/guards/blocks-react-hook-return-types.test.mjs` can only see SPELLING:
 * that a symbol called `UseX` is declared, exported and re-exported. It cannot
 * see whether that symbol has anything to do with what `useX` actually returns.
 * A `UseBuzzBalance` nobody uses would satisfy it completely.
 *
 * The assertions below close that. Each one demands MUTUAL assignability
 * between `ReturnType<typeof useX>` and `UseX`, so `tsc` fails the build the
 * moment the named type stops describing what the hook actually returns.
 *
 * 🔴 WHAT THIS FILE CANNOT SEE, MEASURED RATHER THAN ASSUMED. `Exact` is
 * STRUCTURAL, so re-inlining a hook's annotation as an anonymous literal that
 * happens to equal the named type is invisible here: reverting
 * `useBlockAnalytics(): UseBlockAnalytics` to `(): { track: (e: string) => void }`
 * left `tsc` completely green, because the two shapes are mutually assignable.
 * That half is the guard's — it reads the annotation as TEXT and requires the
 * name. Three checks, three different failure modes:
 *   - the guard's ledger  → the hook SET, failing on grow and on shrink
 *   - the guard's annotation check → the annotation is the NAME, not a literal
 *   - this file           → the NAME is the hook's actual return type
 * None of the three subsumes another.
 *
 * 🔴 `Exact` brackets both sides (`[A] extends [B]`) on purpose. Bare
 * `A extends B` DISTRIBUTES over a union, so a naked conditional would compare
 * `string | undefined` arm by arm and report a match against types that are not
 * the same type at all — `UseHostOrigin` is exactly such a case.
 *
 * This module declares no runtime value; it compiles to an empty ES module.
 */
import type { BlockPickedImageInfo } from '@civitai/app-sdk/blocks';

import type { ImagePickerMultiple } from './useImagePicker.js';
import type {
  useAppStorage,
  useAppWorkflows,
  useBatchEstimate,
  useBlockAnalytics,
  useBlockBreakpoint,
  useBlockContext,
  useBlockResize,
  useBlockSettings,
  useBlockTheme,
  useBlockToken,
  useBuzzAccounts,
  useBuzzBalance,
  useBuzzPurchase,
  useBuzzTransactions,
  useBuzzWorkflow,
  useCheckpointPicker,
  useCivitaiNavigate,
  useCivitaiRoute,
  useCollectionFollow,
  useConsentUnavailable,
  useCreatePostFromApp,
  useDailyCompensation,
  useDirectLoad,
  useDomainMaturity,
  useEntitlements,
  useGatedImages,
  useGenerationResources,
  useGoodPurchase,
  useHostOrigin,
  useImagePicker,
  useImageUpload,
  useMediaUpload,
  useNestedDocument,
  usePublishGenerationOutputs,
  useReactions,
  useRequestConsent,
  useRequestSignIn,
  useResourceFile,
  useResourcePicker,
  useRunConfirmedStep,
  useRunTraining,
  useSaveImage,
  useSharedStorage,
  useTip,
  useTipAllowance,
  useUploadImageBytes,
  useViewer,
  useWildcardPack,
  useWorkflowBatch,
  UseAppStorage,
  UseAppWorkflows,
  UseBatchEstimate,
  UseBlockAnalytics,
  UseBlockBreakpoint,
  UseBlockContext,
  UseBlockResize,
  UseBlockSettings,
  UseBlockTheme,
  UseBlockToken,
  UseBuzzAccounts,
  UseBuzzBalance,
  UseBuzzPurchase,
  UseBuzzTransactions,
  UseBuzzWorkflow,
  UseCheckpointPicker,
  UseCivitaiNavigate,
  UseCivitaiRoute,
  UseCollectionFollow,
  UseConsentUnavailable,
  UseCreatePostFromApp,
  UseDailyCompensation,
  UseDirectLoad,
  UseDomainMaturity,
  UseEntitlements,
  UseGatedImages,
  UseGenerationResources,
  UseGoodPurchase,
  UseHostOrigin,
  UseImagePicker,
  UseImageUpload,
  UseMediaUpload,
  UseNestedDocument,
  UsePublishGenerationOutputs,
  UseReactions,
  UseRequestConsent,
  UseRequestSignIn,
  UseResourceFile,
  UseResourcePicker,
  UseRunConfirmedStep,
  UseRunTraining,
  UseSaveImage,
  UseSharedStorage,
  UseTip,
  UseTipAllowance,
  UseUploadImageBytes,
  UseViewer,
  UseWildcardPack,
  UseWorkflowBatch,
} from '../index.js';

/** Mutual assignability. Bracketed so unions are compared whole — see above. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compiles only when `T` is `true`. A `false` here IS the build failure. */
type Assert<T extends true> = T;

type _useAppStorage = Assert<Exact<ReturnType<typeof useAppStorage>, UseAppStorage>>;
type _useAppWorkflows = Assert<Exact<ReturnType<typeof useAppWorkflows>, UseAppWorkflows>>;
type _useBatchEstimate = Assert<Exact<ReturnType<typeof useBatchEstimate>, UseBatchEstimate>>;
type _useBlockAnalytics = Assert<Exact<ReturnType<typeof useBlockAnalytics>, UseBlockAnalytics>>;
type _useBlockBreakpoint = Assert<Exact<ReturnType<typeof useBlockBreakpoint>, UseBlockBreakpoint>>;
type _useBlockContext = Assert<Exact<ReturnType<typeof useBlockContext>, UseBlockContext>>;
type _useBlockResize = Assert<Exact<ReturnType<typeof useBlockResize>, UseBlockResize>>;
type _useBlockSettings = Assert<Exact<ReturnType<typeof useBlockSettings>, UseBlockSettings>>;
type _useBlockTheme = Assert<Exact<ReturnType<typeof useBlockTheme>, UseBlockTheme>>;
type _useBlockToken = Assert<Exact<ReturnType<typeof useBlockToken>, UseBlockToken>>;
type _useBuzzAccounts = Assert<Exact<ReturnType<typeof useBuzzAccounts>, UseBuzzAccounts>>;
type _useBuzzBalance = Assert<Exact<ReturnType<typeof useBuzzBalance>, UseBuzzBalance>>;
type _useBuzzPurchase = Assert<Exact<ReturnType<typeof useBuzzPurchase>, UseBuzzPurchase>>;
type _useBuzzTransactions = Assert<
  Exact<ReturnType<typeof useBuzzTransactions>, UseBuzzTransactions>
>;
type _useBuzzWorkflow = Assert<Exact<ReturnType<typeof useBuzzWorkflow>, UseBuzzWorkflow>>;
type _useCheckpointPicker = Assert<
  Exact<ReturnType<typeof useCheckpointPicker>, UseCheckpointPicker>
>;
type _useCivitaiNavigate = Assert<Exact<ReturnType<typeof useCivitaiNavigate>, UseCivitaiNavigate>>;
type _useCivitaiRoute = Assert<Exact<ReturnType<typeof useCivitaiRoute>, UseCivitaiRoute>>;
type _useCollectionFollow = Assert<
  Exact<ReturnType<typeof useCollectionFollow>, UseCollectionFollow>
>;
type _useConsentUnavailable = Assert<
  Exact<ReturnType<typeof useConsentUnavailable>, UseConsentUnavailable>
>;
type _useCreatePostFromApp = Assert<
  Exact<ReturnType<typeof useCreatePostFromApp>, UseCreatePostFromApp>
>;
type _useDailyCompensation = Assert<
  Exact<ReturnType<typeof useDailyCompensation>, UseDailyCompensation>
>;
type _useDirectLoad = Assert<Exact<ReturnType<typeof useDirectLoad>, UseDirectLoad>>;
type _useDomainMaturity = Assert<Exact<ReturnType<typeof useDomainMaturity>, UseDomainMaturity>>;
type _useEntitlements = Assert<Exact<ReturnType<typeof useEntitlements>, UseEntitlements>>;
type _useGatedImages = Assert<Exact<ReturnType<typeof useGatedImages>, UseGatedImages>>;
type _useGenerationResources = Assert<
  Exact<ReturnType<typeof useGenerationResources>, UseGenerationResources>
>;
type _useGoodPurchase = Assert<Exact<ReturnType<typeof useGoodPurchase>, UseGoodPurchase>>;
type _useHostOrigin = Assert<Exact<ReturnType<typeof useHostOrigin>, UseHostOrigin>>;
/**
 * 🔴 OVERLOADED, SO THIS LINE COVERS ONE ARM OF FOUR — say so rather than let
 * it read as full coverage. `ReturnType` resolves an overloaded function to its
 * LAST signature, which here is the default `{ purpose?: 'display' }` call. No
 * conditional-type trick reaches the earlier three: overload resolution inside
 * `infer` also picks the last signature, so an `Exact` written for them would
 * compare the display arm against the generationSource type and fail for a
 * reason that has nothing to do with the code.
 *
 * What covers them instead: {@link UseImageUploadGenerationSource},
 * {@link UseImageUploadTrainingData} and {@link UseImageUploadAsyncScan} are the
 * LITERAL return annotations on their overload signatures, and `tsc` checks
 * every overload signature against the implementation's. Rename or gut any one
 * and the build fails at the declaration, not here.
 */
type _useImageUpload = Assert<Exact<ReturnType<typeof useImageUpload>, UseImageUpload>>;
type _useNestedDocument = Assert<Exact<ReturnType<typeof useNestedDocument>, UseNestedDocument>>;
type _usePublishGenerationOutputs = Assert<
  Exact<ReturnType<typeof usePublishGenerationOutputs>, UsePublishGenerationOutputs>
>;
type _useReactions = Assert<Exact<ReturnType<typeof useReactions>, UseReactions>>;
type _useRequestConsent = Assert<Exact<ReturnType<typeof useRequestConsent>, UseRequestConsent>>;
type _useRequestSignIn = Assert<Exact<ReturnType<typeof useRequestSignIn>, UseRequestSignIn>>;
type _useImagePicker = Assert<Exact<ReturnType<typeof useImagePicker>, UseImagePicker>>;
type _useMediaUpload = Assert<Exact<ReturnType<typeof useMediaUpload>, UseMediaUpload>>;
type _useResourcePicker = Assert<Exact<ReturnType<typeof useResourcePicker>, UseResourcePicker>>;
type _useRunConfirmedStep = Assert<
  Exact<ReturnType<typeof useRunConfirmedStep>, UseRunConfirmedStep>
>;
type _useRunTraining = Assert<Exact<ReturnType<typeof useRunTraining>, UseRunTraining>>;
type _useSaveImage = Assert<Exact<ReturnType<typeof useSaveImage>, UseSaveImage>>;
type _useSharedStorage = Assert<Exact<ReturnType<typeof useSharedStorage>, UseSharedStorage>>;
type _useTip = Assert<Exact<ReturnType<typeof useTip>, UseTip>>;
type _useTipAllowance = Assert<Exact<ReturnType<typeof useTipAllowance>, UseTipAllowance>>;
type _useUploadImageBytes = Assert<
  Exact<ReturnType<typeof useUploadImageBytes>, UseUploadImageBytes>
>;
type _useViewer = Assert<Exact<ReturnType<typeof useViewer>, UseViewer>>;
type _useWildcardPack = Assert<Exact<ReturnType<typeof useWildcardPack>, UseWildcardPack>>;
type _useResourceFile = Assert<Exact<ReturnType<typeof useResourceFile>, UseResourceFile>>;
type _useWorkflowBatch = Assert<Exact<ReturnType<typeof useWorkflowBatch>, UseWorkflowBatch>>;

/**
 * `useImagePicker().open` is OVERLOADED, and `ReturnType` reads only the last
 * signature, so the line above cannot see what each overload resolves with.
 * This reads all three, in declaration order, with their option types.
 *
 * The third exists for a `multiple` decided at runtime
 * (`open({ multiple: many ? { max: 3 } : undefined })`), which neither of the
 * first two accepts. The last three assertions pin exactly that: the toggle's
 * argument fits the third signature and neither of the others.
 */
type ImagePickerOpenSignatures = UseImagePicker['open'] extends {
  (opts?: infer SingleOpts): infer SingleResult;
  (opts: infer MultiOpts): infer MultiResult;
  (opts: infer ToggleOpts): infer ToggleResult;
}
  ? {
      singleOpts: SingleOpts;
      single: SingleResult;
      multiOpts: MultiOpts;
      multi: MultiResult;
      toggleOpts: ToggleOpts;
      toggle: ToggleResult;
    }
  : never;
type ImagePickerToggleArg = { multiple: ImagePickerMultiple | undefined };
type _imagePickerSingle = Assert<
  Exact<ImagePickerOpenSignatures['single'], Promise<BlockPickedImageInfo | null>>
>;
type _imagePickerMulti = Assert<
  Exact<ImagePickerOpenSignatures['multi'], Promise<BlockPickedImageInfo[]>>
>;
type _imagePickerToggle = Assert<
  Exact<
    ImagePickerOpenSignatures['toggle'],
    Promise<BlockPickedImageInfo | BlockPickedImageInfo[] | null>
  >
>;
type _imagePickerToggleFits = Assert<
  ImagePickerToggleArg extends ImagePickerOpenSignatures['toggleOpts'] ? true : false
>;
// Two assertions, not one against a union of the two option types: TypeScript
// accepts `{ multiple: A | undefined }` for `{ multiple?: undefined } | { multiple: A }`
// by splitting it across the union, which overload resolution never does.
type _imagePickerToggleMissesSingle = Assert<
  ImagePickerToggleArg extends ImagePickerOpenSignatures['singleOpts'] ? false : true
>;
type _imagePickerToggleMissesMulti = Assert<
  ImagePickerToggleArg extends ImagePickerOpenSignatures['multiOpts'] ? false : true
>;

export {};
