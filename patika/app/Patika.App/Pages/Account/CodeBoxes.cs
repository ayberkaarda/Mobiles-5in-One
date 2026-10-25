using System.ComponentModel;
using Microsoft.Maui.Controls.Shapes;
using Patika.App.ViewModels.Account;

namespace Patika.App.Pages.Account;

/// <summary>
/// The six code boxes of canvas "Dogrulama". One numeric field lies over the boxes, so typing, pasting and
/// the SMS/e-mail autofill all land in a single input that screen readers announce as one.
/// </summary>
public sealed class CodeBoxes : ContentView
{
    private readonly Label[] digits = new Label[CodeEntryViewModel.CodeLength];
    private readonly Border[] boxes = new Border[CodeEntryViewModel.CodeLength];
    private readonly Entry input;
    private CodeEntryViewModel? model;

    public CodeBoxes()
    {
        var grid = new Grid { ColumnSpacing = 8, HeightRequest = 60 };
        for (var i = 0; i < CodeEntryViewModel.CodeLength; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition(GridLength.Star));
            digits[i] = new Label
            {
                FontFamily = "NunitoExtraBold",
                FontSize = 26,
                HorizontalOptions = LayoutOptions.Center,
                VerticalOptions = LayoutOptions.Center,
            };
            boxes[i] = new Border
            {
                BackgroundColor = Token("Beyaz"),
                Stroke = Token("Sis"),
                StrokeThickness = 1,
                StrokeShape = new RoundRectangle { CornerRadius = 12 },
                Content = digits[i],
            };
            SemanticProperties.SetDescription(boxes[i], $"{i + 1}. hane");
            grid.Add(boxes[i], i);
        }

        input = new Entry
        {
            Keyboard = Keyboard.Numeric,
            MaxLength = CodeEntryViewModel.MaxInputLength,
            Opacity = 0.02,
            AutomationId = "CodeEntry",
        };
        SemanticProperties.SetDescription(input, "6 haneli doğrulama kodu");
        // Normalize before anything is cut: the view model keeps digits only, at most six; Render writes them back.
        input.TextChanged += (_, e) =>
        {
            model?.AcceptInput(e.NewTextValue);
            Render();
        };
        input.Focused += (_, _) => Highlight();
        input.Unfocused += (_, _) => Highlight();
        grid.Add(input, 0);
        Grid.SetColumnSpan(input, CodeEntryViewModel.CodeLength);

        var tap = new TapGestureRecognizer();
        tap.Tapped += (_, _) => input.Focus();
        grid.GestureRecognizers.Add(tap);
        Content = grid;
    }

    /// <summary>A one-second timer that refreshes the resend countdown while the page is visible.</summary>
    public static IDispatcherTimer SecondTimer(IDispatcher dispatcher, CodeEntryViewModel viewModel)
    {
        var timer = dispatcher.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(1);
        timer.Tick += (_, _) => viewModel.Tick();
        return timer;
    }

    protected override void OnBindingContextChanged()
    {
        base.OnBindingContextChanged();
        if (model is not null)
        {
            model.PropertyChanged -= OnModelChanged;
        }

        model = BindingContext as CodeEntryViewModel;
        if (model is not null)
        {
            model.PropertyChanged += OnModelChanged;
        }

        Render();
    }

    private void OnModelChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(CodeEntryViewModel.Code) or nameof(CodeEntryViewModel.HasError))
        {
            Dispatcher.Dispatch(Render);
        }
    }

    private void Render()
    {
        var code = model?.Code ?? "";
        if (!string.Equals(input.Text ?? "", code, StringComparison.Ordinal))
        {
            input.Text = code;
        }

        var shown = model?.Digits ?? [];
        for (var i = 0; i < digits.Length; i++)
        {
            digits[i].Text = i < shown.Count ? shown[i] : "";
        }

        Highlight();
    }

    private void Highlight()
    {
        var next = Math.Min(model?.Code.Length ?? 0, CodeEntryViewModel.CodeLength - 1);
        var failed = model?.HasError == true;
        for (var i = 0; i < boxes.Length; i++)
        {
            var active = input.IsFocused && i == next;
            boxes[i].Stroke = failed ? Token("AcilDeep") : active ? Token("TekirDeep") : Token("Sis");
            boxes[i].StrokeThickness = active || failed ? 2 : 1;
        }
    }

    private static Color Token(string key) =>
        Application.Current?.Resources.TryGetValue(key, out var value) == true && value is Color color ? color : Colors.Black;
}
