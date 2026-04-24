package config

// Config holds runtime configuration for the management panel.
type Config struct {
	Listen      string
	Upstream    string
	APIKey      string
	StaticDir   string
	PanelSecret string
}
