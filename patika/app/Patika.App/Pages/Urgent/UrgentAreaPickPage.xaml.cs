using Patika.App.ViewModels.Urgent;

namespace Patika.App.Pages.Urgent;

public partial class UrgentAreaPickPage : ContentPage, IQueryAttributable
{
    private readonly UrgentAreaPickViewModel viewModel;
    private readonly AreaDrawable drawable = new() { RadiusMeters = 2000 };
    private PointF applied;

    public UrgentAreaPickPage(UrgentAreaPickViewModel viewModel)
    {
        InitializeComponent();
        BindingContext = this.viewModel = viewModel;
        AreaMap.Drawable = drawable;

        var pan = new PanGestureRecognizer();
        pan.PanUpdated += OnPan;
        AreaMap.GestureRecognizers.Add(pan);
    }

    public async void ApplyQueryAttributes(IDictionary<string, object> query) => await viewModel.ApplyQueryAsync(query);

    private void OnPan(object? sender, PanUpdatedEventArgs e)
    {
        switch (e.StatusType)
        {
            case GestureStatus.Started:
                applied = PointF.Zero;
                break;
            case GestureStatus.Running:
                var total = new PointF((float)e.TotalX, (float)e.TotalY);
                var step = new SizeF(total.X - applied.X, total.Y - applied.Y);
                applied = total;
                drawable.Shift = new PointF(drawable.Shift.X + step.Width, drawable.Shift.Y + step.Height);

                // Dragging the map right moves the area west; dragging it down moves the area north.
                var metresPerPixel = 2000d / Math.Max(1d, Math.Min(AreaMap.Width, AreaMap.Height) * 0.48d);
                viewModel.Move(-step.Width * metresPerPixel, step.Height * metresPerPixel);
                AreaMap.Invalidate();
                break;
        }
    }
}
