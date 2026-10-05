import 'package:askida/core/platform/media_picker.dart';
import 'package:askida/data/models/shop_document.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/merchant/domain/shop_rules.dart';
import 'package:askida/features/merchant/merchant_paths.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_providers.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

String documentKindLabel(AppLocalizations l10n, DocumentKind kind) =>
    switch (kind) {
      DocumentKind.vergiLevhasi => l10n.merchantDocumentVergiLevhasi,
      DocumentKind.isletmeBelgesi => l10n.merchantDocumentIsletmeBelgesi,
    };

String documentFailureText(AppLocalizations l10n, DocumentFailure failure) =>
    switch (failure) {
      DocumentFailure.type => l10n.merchantDocumentWrongType,
      DocumentFailure.size => l10n.merchantDocumentTooLarge,
      DocumentFailure.picker => l10n.merchantDocumentPickerFailed,
      DocumentFailure.limit => l10n.merchantDocumentLimit,
    };

/// Verification documents (vergi levhası, işletme belgesi; up to three):
/// a photo is taken or chosen, sent straight to private storage through a
/// short-lived presigned address, then confirmed by the server.
class DocumentsScreen extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  DocumentKind _kind = DocumentKind.vergiLevhasi;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final state = ref.watch(documentsControllerProvider);
    final controller = ref.read(documentsControllerProvider.notifier);
    final failure = state.failure;
    final problem = state.problem;
    final full = state.uploaded.length >= ShopRules.maxDocuments;
    return MerchantPage(
      title: l10n.merchantDocumentsTitle,
      child: ListView(
        padding: const EdgeInsets.all(AskidaLayout.screenGutter),
        children: [
          Text(
            l10n.merchantDocumentsBody,
            style: theme.textTheme.bodyLarge?.copyWith(color: c.textMuted),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          Text(l10n.merchantDocumentKind, style: theme.textTheme.titleSmall),
          const SizedBox(height: AskidaSpacing.s2),
          RadioGroup<DocumentKind>(
            groupValue: _kind,
            onChanged: (kind) {
              if (kind != null) setState(() => _kind = kind);
            },
            child: Column(
              children: [
                for (final kind in DocumentKind.values)
                  RadioListTile<DocumentKind>(
                    contentPadding: EdgeInsets.zero,
                    value: kind,
                    title: Text(documentKindLabel(l10n, kind)),
                  ),
              ],
            ),
          ),
          const SizedBox(height: AskidaSpacing.s2),
          if (state.busy)
            Semantics(
              liveRegion: true,
              child: Row(
                children: [
                  const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: AskidaSpacing.s3),
                  Expanded(child: Text(l10n.merchantDocumentUploading)),
                ],
              ),
            )
          else
            Wrap(
              spacing: AskidaSpacing.s3,
              runSpacing: AskidaSpacing.s3,
              children: [
                FilledButton.icon(
                  key: const ValueKey('document-camera'),
                  onPressed: full
                      ? null
                      : () => controller.upload(_kind, DocumentSource.camera),
                  icon: const Icon(Icons.photo_camera_outlined),
                  label: Text(l10n.merchantDocumentCamera),
                ),
                FilledButton.tonalIcon(
                  key: const ValueKey('document-gallery'),
                  onPressed: full
                      ? null
                      : () => controller.upload(_kind, DocumentSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined),
                  label: Text(l10n.merchantDocumentGallery),
                ),
              ],
            ),
          if (failure != null || problem != null) ...[
            const SizedBox(height: AskidaSpacing.s3),
            Semantics(
              liveRegion: true,
              child: Text(
                failure != null
                    ? documentFailureText(l10n, failure)
                    : errorMessage(l10n, problem!),
                key: const ValueKey('document-error'),
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: c.dangerText,
                ),
              ),
            ),
          ],
          const SizedBox(height: AskidaSpacing.s6),
          if (state.uploaded.isNotEmpty) ...[
            Text(l10n.merchantDocumentsSent, style: theme.textTheme.titleSmall),
            for (final doc in state.uploaded)
              MerchantRow(
                key: ValueKey('document-${doc.id}'),
                leading: ExcludeSemantics(
                  child: Icon(Icons.check, color: c.success),
                ),
                title: documentKindLabel(l10n, doc.kind),
                subtitle: l10n.merchantDocumentReceived,
              ),
            const SizedBox(height: AskidaSpacing.s4),
          ],
          TextButton(
            onPressed: () => context.go(MerchantPaths.home),
            child: Text(l10n.merchantDocumentsDone),
          ),
        ],
      ),
    );
  }
}
