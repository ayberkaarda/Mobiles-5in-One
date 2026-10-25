using Patika.App.ViewModels.Adoption;

namespace Patika.App.Pages.Adoption;

public partial class AdoptPage : ContentPage
{
    private readonly AdoptViewModel model;
    public AdoptPage(AdoptViewModel model)
    {
        InitializeComponent();
        this.model = model;
        BindingContext = model;
        var page = new AdoptionListContent(model);
        var content = page.Content;
        page.Content = null;
        Content = content;
    }
    protected override async void OnAppearing() { base.OnAppearing(); model.Activate(); await model.RefreshAsync(); }
    protected override void OnDisappearing() { model.Deactivate(); base.OnDisappearing(); }
}
