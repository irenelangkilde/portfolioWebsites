ConstructTemplate

The input is an image (jpg, png, svg) or a json style spec.
The output is an HTML file with a JSON embedded in a comment near the top of the website.

If the input is json, send this query to AI, "Generate a portfolio website for a job hunter majoring in {{MAJOR}}, specializing in {{SPECIALIZATION}} using the attached json attributes. Use placeholders for all textual content. Include a placeholder for a headshot image. For each project and experience listed generate a thumbnail image or icon correlated with the surrounding text."   Structure the color usage in terms of a five-palette scheme, with functions of colors (such as lighter, darker, redder, greener, blue-er) and neutrals available. Call the output proto_template_html.

If the input is an image, send this query to AI, "Generate a portfolio website for a job hunter majoring in {{MAJOR}}, specializing in {{SPECIALIZATION}} using the attached image as a model.  Use placeholders for all textual content. Include a placeholder for a headshot image. For each project and experience listed generate a thumbnail image or icon correlated with the surrounding text. Call the html output proto_template_html. Infer the json attributes shown below (visual_elements, exemplary_attributes, default_color_scheme, design_factors, etc.) Call the this design_json.  Structure the color usage in terms of a five-palette scheme, with functions of colors (such as lighter, darker, redder, greener, blue-er) and neutrals available.


INPUT
major
{{MAJOR}}

specializaton
{{SPECIALIZATION}}