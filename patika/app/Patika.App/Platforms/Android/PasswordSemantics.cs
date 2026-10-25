using AndroidX.Core.View;
using AndroidX.Core.View.Accessibility;
using Microsoft.Maui.Handlers;

namespace Patika.App.Accessibility;

/// <summary>
/// MAUI's accessibility delegate for an Entry with <c>SemanticProperties.Description</c> reports
/// "description, text" as the node text, which for a password field puts the password itself in the
/// accessibility tree (TalkBack, uiautomator, any accessibility service). Password entries get the plain
/// Android label instead: the description as content description and the masked text left to Android,
/// keeping the AutomationId as the node's resource id.
/// </summary>
public static class PasswordSemantics
{
    public static void Configure()
    {
        EntryHandler.Mapper.AppendToMapping(nameof(IView.Semantics), (handler, entry) => Apply(handler, entry));
        EntryHandler.Mapper.AppendToMapping(nameof(IEntry.IsPassword), (handler, entry) => Apply(handler, entry));
    }

    private static void Apply(IEntryHandler handler, IEntry entry)
    {
        if (!entry.IsPassword)
        {
            return;
        }

        ViewCompat.SetAccessibilityDelegate(handler.PlatformView, new PasswordDelegate(entry.AutomationId));
        handler.PlatformView.ContentDescription = entry.Semantics?.Description;
    }

    private sealed class PasswordDelegate(string? automationId) : AccessibilityDelegateCompat
    {
        public override void OnInitializeAccessibilityNodeInfo(global::Android.Views.View? host, AccessibilityNodeInfoCompat? info)
        {
            base.OnInitializeAccessibilityNodeInfo(host, info);
            if (info is not null && host?.Context?.PackageName is { } package && !string.IsNullOrEmpty(automationId))
            {
                info.ViewIdResourceName = $"{package}:id/{automationId}";
            }
        }
    }
}
