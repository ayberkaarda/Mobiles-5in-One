// Writes the web and Android token files from brand/tokens.json.
// Run from the patika folder: dotnet run brand/tools/build-tokens.cs
using System.Globalization;
using System.Text;
using System.Text.Json;

var root = FindRoot(Directory.GetCurrentDirectory());
var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "brand", "tokens.json")));
var t = json.RootElement;
var inv = CultureInfo.InvariantCulture;
const string Notice = "Built from brand/tokens.json by brand/tools/build-tokens.cs. Edit the JSON and rerun; do not edit by hand.";

// Web: CSS custom properties.
var css = new StringBuilder();
css.AppendLine($"/* {Notice} */");
css.AppendLine(":root {");
foreach (var c in t.GetProperty("color").EnumerateObject())
{
    css.AppendLine($"  --color-{c.Name}: {c.Value.GetProperty("$value").GetString()};");
}
foreach (var s in t.GetProperty("size").EnumerateObject())
{
    css.AppendLine($"  --size-{s.Name}: {Rem(s.Value)};");
}
foreach (var l in t.GetProperty("leading").EnumerateObject())
{
    css.AppendLine($"  --leading-{l.Name}: {l.Value.GetProperty("$value").GetDouble().ToString(inv)};");
}
foreach (var s in t.GetProperty("space").EnumerateObject())
{
    css.AppendLine($"  --space-{s.Name}: {Rem(s.Value)};");
}
foreach (var r in t.GetProperty("radius").EnumerateObject())
{
    css.AppendLine($"  --radius-{r.Name}: {r.Value.GetProperty("$value").GetDouble().ToString(inv)}px;");
}
foreach (var r in t.GetProperty("trail").EnumerateObject())
{
    css.AppendLine($"  --trail-{r.Name}: {r.Value.GetProperty("$value").GetDouble().ToString(inv)}px;");
}
foreach (var m in t.GetProperty("motion").EnumerateObject())
{
    css.AppendLine($"  --motion-{m.Name}: {m.Value.GetProperty("$value").GetDouble().ToString(inv)}ms;");
}
var font = t.GetProperty("font");
css.AppendLine($"  --font-display: \"{font.GetProperty("display").GetProperty("family").GetString()}\", \"Nunito Sans\", system-ui, sans-serif;");
css.AppendLine($"  --font-body: \"{font.GetProperty("body").GetProperty("family").GetString()}\", system-ui, sans-serif;");
css.AppendLine("}");
var cssPath = Path.Combine(root, "src", "Patika.Web", "wwwroot", "css", "tokens.css");
Directory.CreateDirectory(Path.GetDirectoryName(cssPath)!);
File.WriteAllText(cssPath, css.ToString().Replace("\r\n", "\n"));

// Android: a MAUI resource dictionary.
var xaml = new StringBuilder();
xaml.AppendLine("<?xml version=\"1.0\" encoding=\"UTF-8\" ?>");
xaml.AppendLine($"<!-- {Notice} -->");
xaml.AppendLine("<ResourceDictionary xmlns=\"http://schemas.microsoft.com/dotnet/2021/maui\"");
xaml.AppendLine("                    xmlns:x=\"http://schemas.microsoft.com/winfx/2009/xaml\">");
foreach (var c in t.GetProperty("color").EnumerateObject())
{
    xaml.AppendLine($"    <Color x:Key=\"{Pascal(c.Name)}\">{c.Value.GetProperty("$value").GetString()}</Color>");
}
foreach (var s in t.GetProperty("size").EnumerateObject())
{
    xaml.AppendLine($"    <x:Double x:Key=\"FontSize{Pascal(s.Name)}\">{Num(s.Value)}</x:Double>");
}
foreach (var s in t.GetProperty("space").EnumerateObject())
{
    xaml.AppendLine($"    <x:Double x:Key=\"Space{s.Name}\">{Num(s.Value)}</x:Double>");
}
foreach (var r in t.GetProperty("radius").EnumerateObject())
{
    xaml.AppendLine($"    <x:Double x:Key=\"Radius{Pascal(r.Name)}\">{Num(r.Value)}</x:Double>");
}
foreach (var r in t.GetProperty("trail").EnumerateObject())
{
    xaml.AppendLine($"    <x:Double x:Key=\"Trail{Pascal(r.Name)}\">{Num(r.Value)}</x:Double>");
}
xaml.AppendLine("</ResourceDictionary>");
var xamlPath = Path.Combine(root, "app", "Patika.App", "Resources", "Styles", "Tokens.xaml");
Directory.CreateDirectory(Path.GetDirectoryName(xamlPath)!);
File.WriteAllText(xamlPath, xaml.ToString().Replace("\r\n", "\n"));

Console.WriteLine($"tokens.css -> {cssPath}");
Console.WriteLine($"Tokens.xaml -> {xamlPath}");

string Rem(JsonElement e) => (e.GetProperty("$value").GetDouble() / 16).ToString("0.####", inv) + "rem";
string Num(JsonElement e) => e.GetProperty("$value").GetDouble().ToString(inv);

static string Pascal(string name) =>
    string.Concat(name.Split('-').Select(p => char.ToUpperInvariant(p[0]) + p[1..]));

static string FindRoot(string start)
{
    foreach (var candidate in new[] { start, Path.Combine(start, "patika") })
    {
        if (File.Exists(Path.Combine(candidate, "brand", "tokens.json")))
        {
            return candidate;
        }
    }
    throw new InvalidOperationException("Run from the patika folder or its parent: brand/tokens.json not found.");
}
