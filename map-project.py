import os
import json
import re
from bs4 import BeautifulSoup

def generate_graph(directory="."):
    nodes = set()
    edges = []
    
    # Regex to hunt for JS imports and API fetch calls
    js_import = re.compile(r'import\s+(?:.*?\s+from\s+)?["\']([^"\']+)["\']')
    js_fetch = re.compile(r'fetch\(\s*["\']([^"\']+)["\']')

    for root, _, files in os.walk(directory):
        # Ignore external dependencies and version control
        if 'node_modules' in root or '.git' in root: 
            continue

        for file in files:
            if not file.endswith(('.html', '.js', '.css')): 
                continue
            
            # Normalize the file paths to use forward slashes
            file_path = os.path.relpath(os.path.join(root, file), directory).replace('\\', '/')
            nodes.add(file_path)

            try:
                with open(os.path.join(root, file), 'r', encoding='utf-8') as f:
                    content = f.read()
            except Exception:
                continue

            deps = []
            
            # 1. Parse HTML files using BeautifulSoup
            if file.endswith('.html'):
                soup = BeautifulSoup(content, 'html.parser')
                
                # Find all JS scripts
                for script in soup.find_all('script', src=True):
                    deps.append(script['src'])
                
                # Find all CSS stylesheets
                for link in soup.find_all('link', href=True):
                    deps.append(link['href'])
                    
                # Find all HTML links to other pages
                for a in soup.find_all('a', href=True):
                    if a['href'].endswith('.html'):
                        deps.append(a['href'])
            
            # 2. Parse JS files using Regex
            elif file.endswith('.js'):
                deps.extend(js_import.findall(content))
                deps.extend(js_fetch.findall(content))

            # 3. Resolve the connections
            for dep in deps:
                # Ignore external web links, CDNs, or anchor tags
                if dep.startswith('http') or dep.startswith('//') or dep.startswith('#'): 
                    continue

                # If it's a web URL (like your Cloudflare worker), map it as a distinct node directly
                if dep.startswith('http') or dep.startswith('//'):
                    edges.append({"from": file_path, "to": dep})
                    nodes.add(dep)
                    continue
                
                # Resolve relative paths (e.g., index.html -> scripts/main.js)
                base_dir = os.path.dirname(file_path)
                resolved_dep = os.path.normpath(os.path.join(base_dir, dep)).replace('\\', '/')
                
                edges.append({"from": file_path, "to": resolved_dep})
                nodes.add(resolved_dep)

    # Format the data for the Vis.js visualization library
    vis_nodes = [{"id": n, "label": os.path.basename(n), "title": n, "group": n.split('.')[-1]} for n in nodes]
    
    # Convert Python dictionaries to JSON strings
    nodes_json = json.dumps(vis_nodes)
    edges_json = json.dumps(edges)

    # Generate a standalone HTML file containing the interactive graph
    html_template = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>MindAR Dependency Graph</title>
        <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
        <style>
            body { margin: 0; padding: 0; background-color: #1e1e1e; color: white; font-family: sans-serif; }
            #mynetwork { width: 100vw; height: 100vh; }
        </style>
    </head>
    <body>
        <div id="mynetwork"></div>
        <script type="text/javascript">
            // Inject the generated JSON data here
            var nodes = new vis.DataSet(NODES_DATA);
            var edges = new vis.DataSet(EDGES_DATA);
            
            var container = document.getElementById('mynetwork');
            var data = { nodes: nodes, edges: edges };
            var options = {
                nodes: { 
                    shape: 'dot', 
                    size: 16, 
                    font: { color: '#ffffff', face: 'Arial' } 
                },
                edges: { 
                    arrows: 'to', 
                    color: '#666666', 
                    smooth: { type: 'continuous' } 
                },
                groups: {
                    html: { color: '#e34c26' }, // Orange for HTML
                    js: { color: '#f1e05a' },   // Yellow for JS
                    css: { color: '#563d7c' }   // Purple for CSS
                },
                physics: { 
                    stabilization: false, 
                    barnesHut: { springLength: 150 } 
                }
            };
            var network = new vis.Network(container, data, options);
        </script>
    </body>
    </html>
    """
    
    # Replace the placeholders with the actual JSON data
    final_html = html_template.replace('NODES_DATA', nodes_json).replace('EDGES_DATA', edges_json)
    
    # Write the output file
    with open('mindar-graph.html', 'w', encoding='utf-8') as f:
        f.write(final_html)
        
    print("Graph generated! Open 'mindar-graph.html' in your browser.")

if __name__ == "__main__":
    generate_graph()